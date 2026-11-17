// Typed parameters and how a stored value becomes a number at render time.
//
// A stored parameter value is either a literal, or a "driven" value:
//   { ramp: [firstReel, fullFace], curve?, signal? }   two values and a curve
//        between them, driven by a 0..1 signal (default 'progress'). This is
//        the Reel Life Look editor's "first reels → full face" model.
//   { lfo: { wave, freq, min, max, phase } }            a low-frequency oscillator
//   { signal: 'desire', min, max }                       an external signal mapped to a range
// Keyframes, audio, MIDI and face drivers arrive in Phase 7 and slot in here.

import { clamp, lerp, parseColor } from './util';

export type ParamKind = 'float' | 'int' | 'bool' | 'enum' | 'color' | 'ramp' | 'vec2' | 'quad' | 'rect' | 'string' | 'strings' | 'seed';

export interface ParamDef {
  name: string;
  label?: string;
  kind: ParamKind;
  default: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: string[]; // enum
  unit?: 'px' | 'deg' | '%' | 's' | '';
  description?: string;
  /** If false the parameter is not exposed as a GLSL uniform automatically. */
  uniform?: boolean;
  /** Number of colours for 'ramp' params in GLSL (max). */
  maxStops?: number;
}

export interface Ramp { ramp: [unknown, unknown]; curve?: 'linear' | 'ease' | 'in' | 'out' | 'hold' | number; signal?: string }
export interface Lfo { lfo: { wave?: 'sine' | 'triangle' | 'square' | 'saw' | 'random'; freq?: number; min?: number; max?: number; phase?: number } }
export interface SignalDrive { signal: string; min?: number; max?: number }
export type Driven = Ramp | Lfo | SignalDrive;

export interface EvalContext {
  time: number; // seconds
  signals: Record<string, number>;
}

export function isDriven(v: unknown): v is Driven {
  return !!v && typeof v === 'object' && !Array.isArray(v) && ('ramp' in (v as object) || 'lfo' in (v as object) || 'signal' in (v as object));
}

/** True if the resolved value can change with time (for cache invalidation). */
export function dependsOnTime(v: unknown): boolean {
  return !!v && typeof v === 'object' && 'lfo' in (v as object);
}

function curveT(t: number, c: Ramp['curve']): number {
  t = clamp(t, 0, 1);
  if (typeof c === 'number') return Math.pow(t, c);
  switch (c) {
    case 'ease': return t * t * (3 - 2 * t);
    case 'in': return t * t;
    case 'out': return 1 - (1 - t) * (1 - t);
    case 'hold': return t < 1 ? 0 : 1;
    default: return t;
  }
}

function hash01(n: number): number {
  let h = Math.imul((n | 0) ^ 0x27d4eb2d, 0x165667b1);
  h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

function mixValues(a: unknown, b: unknown, t: number): unknown {
  if (typeof a === 'number' && typeof b === 'number') return lerp(a, b, t);
  if (Array.isArray(a) && Array.isArray(b)) return a.map((x, i) => (typeof x === 'number' ? lerp(x, b[i] as number, t) : t < 0.5 ? x : b[i]));
  if (typeof a === 'string' && a[0] === '#' && typeof b === 'string' && b[0] === '#') {
    const ca = parseColor(a), cb = parseColor(b);
    return ca.map((x, i) => lerp(x, cb[i], t));
  }
  return t < 0.5 ? a : b;
}

export function resolveValue(v: unknown, def: ParamDef | undefined, ctx: EvalContext): unknown {
  if (!isDriven(v)) return v === undefined ? def?.default : v;
  if ('ramp' in v) {
    const t = curveT(ctx.signals[v.signal ?? 'progress'] ?? 0, v.curve);
    return snap(mixValues(v.ramp[0], v.ramp[1], t), def);
  }
  if ('lfo' in v) {
    const { wave = 'sine', freq = 0.25, min = 0, max = 1, phase = 0 } = v.lfo;
    const x = ctx.time * freq + phase, f = x - Math.floor(x);
    let u: number;
    switch (wave) {
      case 'triangle': u = 1 - Math.abs(f * 2 - 1); break;
      case 'square': u = f < 0.5 ? 1 : 0; break;
      case 'saw': u = f; break;
      case 'random': u = hash01(Math.floor(x)); break;
      default: u = 0.5 + 0.5 * Math.sin(x * Math.PI * 2);
    }
    return snap(lerp(min, max, u), def);
  }
  const s = ctx.signals[v.signal] ?? 0;
  return snap(lerp(v.min ?? 0, v.max ?? 1, clamp(s, 0, 1)), def);
}

function snap(x: unknown, def?: ParamDef): unknown {
  if (def?.kind === 'int' && typeof x === 'number') return Math.round(x);
  return x;
}

/** Resolve every parameter of an effect/generator to concrete values. */
export function resolveParams(defs: ParamDef[], stored: Record<string, unknown> | undefined, ctx: EvalContext): { values: Record<string, any>; timeDependent: boolean } {
  const values: Record<string, any> = {};
  let timeDependent = false;
  for (const d of defs) {
    const raw = stored?.[d.name];
    if (dependsOnTime(raw)) timeDependent = true;
    let v = resolveValue(raw, d, ctx);
    if ((d.kind === 'float' || d.kind === 'int') && typeof v === 'number') {
      if (d.min !== undefined && d.max !== undefined) v = clamp(v, Math.min(d.min, d.max), Math.max(d.min, d.max));
    }
    values[d.name] = v;
  }
  return { values, timeDependent };
}

// ---- shorthand constructors used by effect and generator definitions ----
export const P = {
  float: (name: string, def: number, min: number, max: number, extra: Partial<ParamDef> = {}): ParamDef => ({ name, kind: 'float', default: def, min, max, ...extra }),
  px: (name: string, def: number, min: number, max: number, extra: Partial<ParamDef> = {}): ParamDef => ({ name, kind: 'float', default: def, min, max, unit: 'px', ...extra }),
  deg: (name: string, def: number, extra: Partial<ParamDef> = {}): ParamDef => ({ name, kind: 'float', default: def, min: -360, max: 360, unit: 'deg', ...extra }),
  int: (name: string, def: number, min: number, max: number, extra: Partial<ParamDef> = {}): ParamDef => ({ name, kind: 'int', default: def, min, max, step: 1, ...extra }),
  bool: (name: string, def: boolean, extra: Partial<ParamDef> = {}): ParamDef => ({ name, kind: 'bool', default: def, ...extra }),
  enum: (name: string, def: string, options: string[], extra: Partial<ParamDef> = {}): ParamDef => ({ name, kind: 'enum', default: def, options, ...extra }),
  color: (name: string, def: string, extra: Partial<ParamDef> = {}): ParamDef => ({ name, kind: 'color', default: def, ...extra }),
  ramp: (name: string, def: string[], extra: Partial<ParamDef> = {}): ParamDef => ({ name, kind: 'ramp', default: def, maxStops: 8, ...extra }),
  quad: (name: string, def: number[], extra: Partial<ParamDef> = {}): ParamDef => ({ name, kind: 'quad', default: def, uniform: false, ...extra }),
  rect: (name: string, def: number[], extra: Partial<ParamDef> = {}): ParamDef => ({ name, kind: 'rect', default: def, ...extra }),
  vec2: (name: string, def: number[], extra: Partial<ParamDef> = {}): ParamDef => ({ name, kind: 'vec2', default: def, ...extra }),
  string: (name: string, def: string, extra: Partial<ParamDef> = {}): ParamDef => ({ name, kind: 'string', default: def, uniform: false, ...extra }),
  strings: (name: string, def: string[], extra: Partial<ParamDef> = {}): ParamDef => ({ name, kind: 'strings', default: def, uniform: false, ...extra }),
};
