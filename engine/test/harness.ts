// Headless test harness: Playwright calls window.shard.* to render documents
// at fixed seeds and read the pixels back as PNG data URLs.
import { ShardEngine, EFFECTS, GENERATORS, type ShardDocument } from '../src';
import { fixture, type FixtureName } from './fixtures';

const canvas = document.getElementById('c') as HTMLCanvasElement;
let engine: ShardEngine;

async function ready() {
  engine ??= await ShardEngine.create(canvas, { fontBase: '../fonts/' });
  return engine;
}

async function toDataURL(px: Uint8Array, w: number, h: number, type = 'image/png', scale = 1) {
  let c = new OffscreenCanvas(w, h);
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px.buffer as ArrayBuffer), w, h), 0, 0);
  if (scale !== 1) {
    const s = new OffscreenCanvas(Math.round(w * scale), Math.round(h * scale)), x = s.getContext('2d')!;
    x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, s.width, s.height); c = s;
  }
  const blob = await c.convertToBlob({ type, quality: 0.86 });
  return await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(blob); });
}

interface Opts { type?: string; scale?: number; fixture?: FixtureName; time?: number; signals?: Record<string, number>; profile?: boolean; png?: boolean }

async function renderDoc(doc: ShardDocument, o: Opts = {}) {
  const e = await ready();
  await e.load(doc);
  e.setInput('main', fixture(o.fixture ?? 'blank', doc.width, doc.height));
  for (const [k, v] of Object.entries(o.signals ?? {})) e.setSignal(k, v);
  e.renderer.profile = !!o.profile;
  const stats = e.render(o.time ?? 0);
  const out: any = { stats: { ...stats, nodes: stats.nodes.slice(0, 80) } };
  if (o.png !== false) out.png = await toDataURL(e.pixels(), doc.width, doc.height, o.type, o.scale);
  return out;
}

/** Time full (uncached) and cached renders, plus scrubbing one parameter. */
async function bench(doc: ShardDocument, o: Opts & { frames?: number; scrub?: { layer: string; effect: string; param: string; values: number[] } } = {}) {
  const e = await ready();
  await e.load(doc);
  e.setInput('main', fixture(o.fixture ?? 'face', doc.width, doc.height));
  e.renderer.profile = true;
  e.renderer.clearCache();
  // warm-up compiles every shader
  e.render(0); e.renderer.clearCache();
  const cold: number[] = [];
  for (let i = 0; i < 3; i++) { e.renderer.clearCache(); const t = performance.now(); e.render(0);  cold.push(performance.now() - t); }
  e.renderer.profile = true; e.renderer.clearCache(); e.render(0);
  const perNode = e.renderer.stats.nodes.filter((n) => !n.cached).map((n) => ({ label: n.label, ms: +n.ms.toFixed(2) }));
  e.renderer.profile = false;
  const cached: number[] = [];
  for (let i = 0; i < 5; i++) { const t = performance.now(); e.render(0);  cached.push(performance.now() - t); }
  const scrub: number[] = [];
  if (o.scrub) {
    for (const v of o.scrub.values) {
      const d = e.doc!;
      const find = (ls: any[]): any => { for (const l of ls) { if (l.id === o.scrub!.layer) return l; if (l.layers) { const f = find(l.layers); if (f) return f; } } };
      const fx = find(d.layers).effects.find((x: any) => x.id === o.scrub!.effect);
      fx.params = { ...(fx.params ?? {}), [o.scrub.param]: v };
      const t = performance.now(); e.render(0);  scrub.push(performance.now() - t);
    }
  }
  const live: number[] = [];
  for (let i = 0; i < (o.frames ?? 5); i++) { e.touchInput('main'); const t = performance.now(); e.render(i / 30);  live.push(performance.now() - t); }
  const med = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);
  return { cold: med(cold), cached: med(cached), scrub: med(scrub), live: med(live), perNode, renderer: (e.gpu.gl.getParameter(e.gpu.gl.RENDERER) as string), halfFloat: e.gpu.canHalfFloat };
}

(window as any).shard = {
  renderDoc, bench,
  effects: () => Object.values(EFFECTS).map((e) => ({ id: e.id, name: e.name, category: e.category, live: e.live })),
  generators: () => Object.values(GENERATORS).map((g) => ({ id: g.id, name: g.name, live: g.live })),
};
(window as any).shardReady = true;
