// Evaluates a document into a texture, caching every node's output.
//
// Every node (layer content, each effect step, each mask, each composite)
// has a stable key (its path in the tree) and a hash of everything that
// affects its pixels (resolved parameters, seed, inputs' hashes, time when
// animated). If the hash is unchanged, the cached texture is reused, so
// scrubbing one parameter only re-renders that node and what depends on it.

import type { ShardDocument, Layer, EffectInstance, Mask, Fit } from './doc';
import type { GPU, Target } from './gl/gpu';
import type { EvalContext } from './params';
import { resolveParams, resolveValue } from './params';
import { EFFECTS } from './effects';
import { GENERATORS } from './generators';
import { effectSource, generatorSource, paramUniforms, type NodeInfo, type EffectRenderContext } from './nodes';
import { COMPOSITE_FRAG, blendIndex } from './blend';
import { MaskRenderer } from './masks';
import { hashValue, mixSeed, fnv } from './util';

export interface InputSource {
  source: TexImageSource | null;
  width: number;
  height: number;
  /** Bump when the pixels change (every frame for live video). */
  version: number;
}

export interface RenderOptions extends EvalContext {
  inputs: Map<string, InputSource>;
  assets: Map<string, ImageBitmap | HTMLImageElement>;
}

export interface NodeTiming { key: string; label: string; ms: number; cached: boolean }

export interface RenderStats {
  ms: number;
  rendered: number;
  cached: number;
  nodes: NodeTiming[];
}

interface Node { target: Target; hash: string }

export class Renderer {
  private cache = new Map<string, { hash: string; target: Target; used: number }>();
  private frame = 0;
  private masks: MaskRenderer;
  private blank: Target | null = null;
  stats: RenderStats = { ms: 0, rendered: 0, cached: 0, nodes: [] };
  /** Measure per-node GPU time with gl.finish (slower; for the frame-time meter). */
  profile = false;

  constructor(readonly gpu: GPU) {
    this.masks = new MaskRenderer(gpu);
  }

  clearCache() {
    for (const c of this.cache.values()) this.gpu.destroy(c.target);
    this.cache.clear();
  }

  render(doc: ShardDocument, opt: RenderOptions): Target {
    const t0 = performance.now();
    this.frame++;
    this.stats = { ms: 0, rendered: 0, cached: 0, nodes: [] };
    const { width: w, height: h } = doc;
    const bgHash = hashValue(['bg', doc.background, w, h]);
    const bg = this.node('bg', bgHash, 'Background', () => {
      const t = this.gpu.acquire(w, h);
      const c = doc.background && doc.background.type === 'color' ? doc.background.color : null;
      const prog = this.gpu.program('gen/solid', generatorSource(GENERATORS.solid));
      this.gpu.pass(prog, t, { ...paramUniforms(GENERATORS.solid.params, { color: c ?? [0, 0, 0, 0] }), u_unit: 1 });
      return t;
    });
    const out = this.stack(doc.layers, 'root', bg, doc, opt, doc.seed >>> 0);
    // evict nodes not used this frame (deleted layers, old keys)
    for (const [k, c] of this.cache) if (c.used !== this.frame) { this.gpu.release(c.target); this.cache.delete(k); }
    this.gpu.finish(out.target);
    this.stats.ms = performance.now() - t0;
    return out.target;
  }

  // ---------------------------------------------------------------- core

  private node(key: string, hash: string, label: string, make: () => Target): Node {
    const c = this.cache.get(key);
    if (c && c.hash === hash) {
      c.used = this.frame;
      this.stats.cached++;
      if (this.profile) this.stats.nodes.push({ key, label, ms: 0, cached: true });
      return { target: c.target, hash };
    }
    const t0 = performance.now();
    const target = make();
    if (this.profile) this.gpu.finish(target);
    const ms = performance.now() - t0;
    if (c) this.gpu.release(c.target);
    this.cache.set(key, { hash, target, used: this.frame });
    this.stats.rendered++;
    this.stats.nodes.push({ key, label, ms, cached: false });
    return { target, hash };
  }

  private info(doc: ShardDocument, seed: number, opt: RenderOptions): NodeInfo {
    return { w: doc.width, h: doc.height, unit: Math.min(doc.width, doc.height) / 1080, seed, time: opt.time };
  }

  private layerSeed(l: Layer, parent: number) {
    return (l.seed ?? mixSeed(parent, parseInt(fnv(l.id).slice(0, 6), 36))) >>> 0;
  }

  /** Composite a list of layers (bottom → top) over `base`. */
  private stack(layers: Layer[], path: string, base: Node, doc: ShardDocument, opt: RenderOptions, seed: number): Node {
    let acc = base;
    for (const l of layers) {
      if (l.visible === false) continue;
      const key = `${path}/${l.id}`;
      const ls = this.layerSeed(l, seed);
      const opacity = Number(resolveValue(l.opacity, undefined, opt) ?? 1);

      if (l.type === 'effect') {
        // applies its stack to everything below, then mixes back by mask × opacity
        const fx = this.effects(l.effects ?? [], key, acc, doc, opt, ls);
        acc = this.composite(`${key}#mix`, acc, fx, l.mask, opacity, l.blend, 1, doc, opt, ls, l.name ?? l.id);
        continue;
      }
      if (l.type === 'group' && l.passThrough) {
        const inner = this.stack(l.layers, key, acc, doc, opt, ls);
        const fx = this.effects(l.effects ?? [], key, inner, doc, opt, ls);
        acc = this.composite(`${key}#mix`, acc, fx, l.mask, opacity, 'normal', 1, doc, opt, ls, l.name ?? l.id);
        continue;
      }
      const content = this.content(l, key, doc, opt, ls);
      if (!content) continue;
      const fx = this.effects(l.effects ?? [], key, content, doc, opt, ls);
      acc = this.composite(`${key}#over`, acc, fx, l.mask, opacity, l.blend, 0, doc, opt, ls, l.name ?? l.id);
    }
    return acc;
  }

  private content(l: Layer, key: string, doc: ShardDocument, opt: RenderOptions, seed: number): Node | null {
    const { width: w, height: h } = doc;
    if (l.type === 'generator') {
      const def = GENERATORS[l.generator];
      const { values } = resolveParams(def.params, l.params, opt);
      const animated = def.animated?.(values) ?? false;
      const hash = hashValue(['gen', l.generator, values, seed, w, h, animated ? opt.time : 0]);
      return this.node(`${key}#gen`, hash, `${l.name ?? l.id}: ${def.name}`, () => {
        const info = this.info(doc, seed, opt);
        if (def.draw) {
          const c = new OffscreenCanvas(w, h);
          const ctx = c.getContext('2d')!;
          def.draw(ctx, info, values);
          return this.gpu.upload(c, w, h);
        }
        const t = this.gpu.acquire(w, h);
        const prog = this.gpu.program(`gen/${def.id}`, generatorSource(def));
        this.gpu.pass(prog, t, { ...paramUniforms(def.params, values), ...(def.uniforms?.(values, info) ?? {}), u_unit: info.unit, u_time: opt.time, u_seed: seed });
        return t;
      });
    }
    if (l.type === 'source' || l.type === 'raster') {
      let src: TexImageSource | null = null, sw = 0, sh = 0, ver: unknown = 0;
      if (l.type === 'source') {
        const inp = opt.inputs.get(l.input);
        if (!inp || !inp.source) return null; // an empty input slot is simply blank
        src = inp.source; sw = inp.width; sh = inp.height; ver = [l.input, inp.version];
      } else {
        const a = opt.assets.get(l.asset);
        if (!a) return null;
        src = a; sw = (a as ImageBitmap).width; sh = (a as ImageBitmap).height; ver = l.asset;
      }
      const fit = l.fit ?? 'cover';
      const mirror = l.type === 'source' && !!l.mirror;
      const hash = hashValue(['img', ver, fit, mirror, w, h]);
      return this.node(`${key}#img`, hash, l.name ?? l.id, () => {
        const c = new OffscreenCanvas(w, h), ctx = c.getContext('2d')!;
        drawFitted(ctx, src as CanvasImageSource, sw, sh, w, h, fit, mirror);
        return this.gpu.upload(c, w, h);
      });
    }
    if (l.type === 'group') {
      const t = this.transparent(w, h);
      return this.stack(l.layers, key, t, doc, opt, seed);
    }
    return null;
  }

  private transparent(w: number, h: number): Node {
    if (!this.blank || this.blank.w !== w || this.blank.h !== h) {
      if (this.blank) this.gpu.destroy(this.blank);
      const c = new OffscreenCanvas(w, h);
      this.blank = this.gpu.upload(c, w, h, this.gpu.acquire(w, h, 'byte'));
    }
    return { target: this.blank, hash: `blank${w}x${h}` };
  }

  private effects(list: EffectInstance[], key: string, input: Node, doc: ShardDocument, opt: RenderOptions, layerSeed: number): Node {
    let cur = input;
    list.forEach((e, i) => {
      if (e.enabled === false) return;
      const def = EFFECTS[e.effect];
      if (!def) return;
      const seed = (e.seed ?? mixSeed(layerSeed, i * 7919 + 13)) >>> 0;
      const { values } = resolveParams(def.params, e.params, opt);
      const amount = Number(resolveValue(e.amount, undefined, opt) ?? 1);
      if (amount <= 0) return;
      const animated = def.animated?.(values) ?? false;
      const fkey = `${key}/fx:${e.id}`;
      const hash = hashValue(['fx', e.effect, values, seed, cur.hash, animated ? opt.time : 0]);
      const raw = this.node(fkey, hash, `${e.name ?? def.name}`, () => this.runEffect(def.id, values, cur.target, doc, opt, seed));
      if (!e.mask && amount >= 1 && (!e.blend || e.blend === 'normal')) { cur = raw; return; }
      cur = this.composite(`${fkey}#mix`, cur, raw, e.mask, amount, e.blend, 1, doc, opt, seed, `${def.name} mix`);
    });
    return cur;
  }

  private runEffect(id: string, values: Record<string, any>, input: Target, doc: ShardDocument, opt: RenderOptions, seed: number): Target {
    const def = EFFECTS[id];
    const info = this.info(doc, seed, opt);
    const gpu = this.gpu;
    const shader = (k: string, glsl: string, uniforms: Record<string, any>, into?: Target) => {
      const t = into ?? gpu.acquire(info.w, info.h);
      gpu.pass(gpu.program(k, glsl), t, { u_src: input, u_unit: info.unit, u_time: info.time, u_seed: seed, ...uniforms });
      return t;
    };
    if (def.render) {
      const rc: EffectRenderContext = { ...info, gpu, input, values, shader };
      return def.render(rc);
    }
    return shader(`fx/${def.id}`, effectSource(def), { ...paramUniforms(def.params, values), ...(def.uniforms?.(values, info) ?? {}) });
  }

  private composite(key: string, below: Node, above: Node, mask: Mask | undefined, opacity: number, blend: string | undefined, op: 0 | 1, doc: ShardDocument, opt: RenderOptions, seed: number, label: string): Node {
    const { width: w, height: h } = doc;
    let maskNode: Node | null = null;
    if (mask) {
      const mh = hashValue(['mask', mask, seed, w, h, mask.shape === 'luma' || mask.shape === 'combine' ? above.hash : 0]);
      maskNode = this.node(`${key}#mask`, mh, `${label} mask`, () => this.masks.render(mask, w, h, seed, above.target));
    }
    const mode = blendIndex(blend as any);
    const hash = hashValue(['comp', below.hash, above.hash, maskNode?.hash ?? 0, opacity, mode, op, seed]);
    return this.node(key, hash, label, () => {
      const t = this.gpu.acquire(w, h);
      const prog = this.gpu.program('composite', COMPOSITE_FRAG);
      this.gpu.pass(prog, t, {
        u_dst: below.target, u_src: above.target, u_mask: maskNode?.target ?? null, u_hasMask: maskNode ? 1 : 0,
        u_opacity: opacity, u_mode: mode, u_op: op, u_unit: Math.min(w, h) / 1080, u_seed: seed,
      });
      return t;
    });
  }
}

export function drawFitted(ctx: OffscreenCanvasRenderingContext2D, img: CanvasImageSource, iw: number, ih: number, w: number, h: number, fit: Fit, mirror = false) {
  let dw = w, dh = h;
  if (fit === 'cover' || fit === 'contain') {
    const s = fit === 'cover' ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
    dw = iw * s; dh = ih * s;
  } else if (fit === 'none') { dw = iw; dh = ih; }
  ctx.save();
  if (mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  ctx.restore();
}
