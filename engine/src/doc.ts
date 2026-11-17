// The document model, validation and (de)serialisation.
//
// A document is a non-destructive graph written as a layer tree: layers hold
// generators, inputs or images; each layer has an ordered effect stack; masks
// place every effect. Pixels are computed, never stored, except raster
// assets. See engine/DOCUMENT_FORMAT.md.

import { EFFECTS } from './effects';
import { GENERATORS } from './generators';

export const FORMAT = 'shard-document';
export const FORMAT_VERSION = 1;

export type BlendMode =
  | 'normal' | 'dissolve' | 'darken' | 'multiply' | 'color-burn' | 'linear-burn' | 'darker-color'
  | 'lighten' | 'screen' | 'color-dodge' | 'linear-dodge' | 'lighter-color'
  | 'overlay' | 'soft-light' | 'hard-light' | 'vivid-light' | 'linear-light' | 'pin-light' | 'hard-mix'
  | 'difference' | 'exclusion' | 'subtract' | 'divide'
  | 'hue' | 'saturation' | 'color' | 'luminosity'
  | 'channel-swap' | 'xor' | 'difference-mosh' | 'luma-displace' | 'channel-offset';

export const BLEND_MODES: BlendMode[] = [
  'normal', 'dissolve', 'darken', 'multiply', 'color-burn', 'linear-burn', 'darker-color',
  'lighten', 'screen', 'color-dodge', 'linear-dodge', 'lighter-color',
  'overlay', 'soft-light', 'hard-light', 'vivid-light', 'linear-light', 'pin-light', 'hard-mix',
  'difference', 'exclusion', 'subtract', 'divide',
  'hue', 'saturation', 'color', 'luminosity',
  'channel-swap', 'xor', 'difference-mosh', 'luma-displace', 'channel-offset',
];

interface MaskCommon {
  invert?: boolean;
  /** Blur the edge, in px (shape masks). */
  feather?: number;
  /** Roughen the edge into a torn-paper outline, in px (shape masks). */
  torn?: number;
  seed?: number;
}
export type Mask =
  | (MaskCommon & { shape: 'ellipse'; cx: number; cy: number; rx: number; ry: number; angle?: number })
  | (MaskCommon & { shape: 'rect'; x: number; y: number; w: number; h: number; angle?: number })
  | (MaskCommon & { shape: 'poly'; points: number[] })
  | (MaskCommon & { shape: 'noise'; scale?: number; threshold?: number; softness?: number; octaves?: number; type?: 'perlin' | 'worley' | 'value' })
  | (MaskCommon & { shape: 'luma'; lo?: number; hi?: number; softness?: number })
  | (MaskCommon & { shape: 'bands'; count?: number; angle?: number; duty?: number; jitter?: number })
  | (MaskCommon & { shape: 'combine'; op: 'add' | 'subtract' | 'intersect'; masks: Mask[] });

export interface EffectInstance {
  id: string;
  effect: string;
  params?: Record<string, unknown>;
  enabled?: boolean;
  /** 0..1 mix of the effect over its input (drivable). */
  amount?: unknown;
  blend?: BlendMode;
  mask?: Mask;
  seed?: number;
  name?: string;
}

interface LayerBase {
  id: string;
  name?: string;
  visible?: boolean;
  locked?: boolean;
  opacity?: unknown;
  blend?: BlendMode;
  effects?: EffectInstance[];
  mask?: Mask;
  seed?: number;
  label?: string;
}
export interface RasterLayer extends LayerBase { type: 'raster'; asset: string; fit?: Fit }
export interface SourceLayer extends LayerBase { type: 'source'; input: string; fit?: Fit; mirror?: boolean }
export interface GeneratorLayer extends LayerBase { type: 'generator'; generator: string; params?: Record<string, unknown> }
export interface EffectLayer extends LayerBase { type: 'effect' }
export interface GroupLayer extends LayerBase { type: 'group'; layers: Layer[]; passThrough?: boolean }
export type Layer = RasterLayer | SourceLayer | GeneratorLayer | EffectLayer | GroupLayer;
export type Fit = 'cover' | 'contain' | 'stretch' | 'none';

export interface Asset { type: 'image'; src: string; name?: string }

export interface ShardDocument {
  format: typeof FORMAT;
  version: number;
  name?: string;
  width: number;
  height: number;
  seed: number;
  background?: { type: 'transparent' } | { type: 'color'; color: string };
  palette?: Record<string, string>;
  /** Named inputs the document expects (live webcam, a test image…). Never stores frames. */
  inputs?: Record<string, { kind: 'image' | 'live'; label?: string }>;
  assets?: Record<string, Asset>;
  /** Default simulated signals (progress, desire…) for previewing ramps. */
  signals?: Record<string, number>;
  layers: Layer[];
}

export class DocumentError extends Error {
  constructor(readonly problems: string[]) {
    super('This document could not be loaded:\n- ' + problems.join('\n- '));
  }
}

const LAYER_TYPES = ['raster', 'source', 'generator', 'effect', 'group'];
const MASK_SHAPES = ['ellipse', 'rect', 'poly', 'noise', 'luma', 'bands', 'combine'];

/** Validate (and migrate) a parsed document. Throws DocumentError with every problem found. */
export function validateDocument(input: unknown): ShardDocument {
  const problems: string[] = [];
  if (!input || typeof input !== 'object') throw new DocumentError(['Not a JSON object.']);
  const d = migrate(input as Record<string, any>);
  if (d.format !== FORMAT) problems.push(`"format" must be "${FORMAT}".`);
  if (typeof d.version !== 'number' || d.version > FORMAT_VERSION) problems.push(`Unsupported version ${d.version}; this engine reads up to ${FORMAT_VERSION}.`);
  if (!(d.width > 0 && d.width <= 16384) || !(d.height > 0 && d.height <= 16384)) problems.push('width and height must be between 1 and 16384.');
  if (typeof d.seed !== 'number') d.seed = 1;
  if (!Array.isArray(d.layers)) problems.push('"layers" must be an array.');
  const ids = new Set<string>();
  const checkMask = (m: any, where: string) => {
    if (!m) return;
    if (!MASK_SHAPES.includes(m.shape)) problems.push(`${where}: unknown mask shape "${m.shape}".`);
    if (m.shape === 'combine') (m.masks ?? []).forEach((x: any, i: number) => checkMask(x, `${where}.masks[${i}]`));
  };
  const walk = (layers: any[], path: string) => {
    layers.forEach((l, i) => {
      const where = `${path}[${i}]${l?.name ? ` "${l.name}"` : ''}`;
      if (!l || typeof l !== 'object') { problems.push(`${where}: not an object.`); return; }
      if (!l.id) l.id = `${path.replace(/\W/g, '')}_${i}`;
      if (ids.has(l.id)) problems.push(`${where}: duplicate layer id "${l.id}".`);
      ids.add(l.id);
      if (!LAYER_TYPES.includes(l.type)) problems.push(`${where}: unknown layer type "${l.type}".`);
      if (l.type === 'generator' && !GENERATORS[l.generator]) problems.push(`${where}: unknown generator "${l.generator}". Known: ${Object.keys(GENERATORS).join(', ')}.`);
      if (l.type === 'raster' && !d.assets?.[l.asset]) problems.push(`${where}: missing asset "${l.asset}".`);
      if (l.blend && !BLEND_MODES.includes(l.blend)) problems.push(`${where}: unknown blend mode "${l.blend}".`);
      checkMask(l.mask, where + '.mask');
      (l.effects ?? []).forEach((e: any, k: number) => {
        if (!e.id) e.id = `${l.id}_fx${k}`;
        if (!EFFECTS[e.effect]) problems.push(`${where}.effects[${k}]: unknown effect "${e.effect}". Known: ${Object.keys(EFFECTS).join(', ')}.`);
        if (e.blend && !BLEND_MODES.includes(e.blend)) problems.push(`${where}.effects[${k}]: unknown blend mode "${e.blend}".`);
        checkMask(e.mask, `${where}.effects[${k}].mask`);
      });
      if (l.type === 'group') {
        if (!Array.isArray(l.layers)) problems.push(`${where}: group needs "layers".`);
        else walk(l.layers, `${where}.layers`);
      }
    });
  };
  if (Array.isArray(d.layers)) walk(d.layers, 'layers');
  if (problems.length) throw new DocumentError(problems);
  return d as ShardDocument;
}

/** Old versions keep loading: each step upgrades one version. */
function migrate(d: Record<string, any>): Record<string, any> {
  const out = structuredClone(d);
  // v0 (pre-release drafts) had no "format" field.
  if (out.format === undefined && Array.isArray(out.layers)) { out.format = FORMAT; out.version = out.version ?? 1; }
  return out;
}

export function serializeDocument(doc: ShardDocument): string {
  return JSON.stringify(doc, null, 2);
}

export function parseDocument(json: string): ShardDocument {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch (e) { throw new DocumentError([`Not valid JSON: ${(e as Error).message}`]); }
  return validateDocument(parsed);
}

export function newDocument(width = 1080, height = 1920, name = 'Untitled'): ShardDocument {
  return { format: FORMAT, version: FORMAT_VERSION, name, width, height, seed: 1, background: { type: 'transparent' }, layers: [] };
}

export const CANVAS_PRESETS: Record<string, [number, number]> = {
  'Reel face': [1080, 1920],
  'HUD satellite': [720, 480],
  'Square 2048': [2048, 2048],
  'A3 300 dpi': [3508, 4961],
  'A2 300 dpi': [4961, 7016],
  '4K landscape': [3840, 2160],
};
