// Golden-image tests, proof renders and benchmarks in headless Chromium.
//
//   npm test                 render every effect, generator and sample, compare with engine/test/golden/
//   npm run test:update      accept the current renders as the new goldens
//   npm run proof            full-size "not just the image" renders → docs/preset-proof/
//   npm run bench            frame times at 1080×1920 and 720×480
//
// Uses the pre-installed Chromium via Playwright; WebGL runs on SwiftShader
// (CPU) in CI, so absolute frame times there are far slower than a real GPU.

import { createServer } from 'vite';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const goldenDir = path.join(root, 'engine/test/golden');
const outDir = path.join(root, 'engine/test/out');
const proofDir = path.join(root, 'docs/preset-proof');
const samplesDir = path.join(root, 'engine/public/samples');
const args = new Set(process.argv.slice(2));
const UPDATE = args.has('--update'), PROOF = args.has('--proof'), BENCH = args.has('--bench');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);

const W = 270, H = 480; // golden size: quarter of the Reel face
const TOL_CHANNEL = 10;   // per-channel difference that counts as a changed pixel
const TOL_SHARE = 0.01;   // share of changed pixels allowed

const server = await createServer({ configFile: path.join(root, 'vite.config.ts'), logLevel: 'error', server: { port: 5199, strictPort: false } });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url + 'test/harness.html');
await page.waitForFunction(() => window.shardReady === true, null, { timeout: 60000 });

const doc = (layers, w = W, h = H, extra = {}) => ({ format: 'shard-document', version: 1, width: w, height: h, seed: 1234, background: { type: 'color', color: '#000000' }, layers, ...extra });
const decode = (dataUrl) => PNG.sync.read(Buffer.from(dataUrl.split(',')[1], 'base64'));
const samples = fs.readdirSync(samplesDir).filter((f) => f.endsWith('.json')).map((f) => ({ name: f.replace(/\.json$/, ''), doc: JSON.parse(fs.readFileSync(path.join(samplesDir, f), 'utf8')) }));

function cases(effects, generators) {
  const list = [];
  for (const e of effects) {
    for (const fx of ['face', 'gradient']) list.push({ name: `effect-${e.id}-${fx}`, fixture: fx, doc: doc([{ id: 'in', type: 'source', input: 'main' }, { id: 'fx', type: 'effect', effects: [{ id: 'e', effect: e.id }] }]) });
  }
  for (const g of generators) list.push({ name: `generator-${g.id}`, doc: doc([{ id: 'g', type: 'generator', generator: g.id }]) });
  list.push({ name: 'blend-modes', doc: doc([
    { id: 'a', type: 'generator', generator: 'gradient', params: { ramp: ['#1B2FD6', '#FF6A1A'], angle: 0 } },
    ...['multiply', 'screen', 'overlay', 'difference', 'hue', 'channel-swap', 'xor', 'luma-displace'].map((m, i) => ({
      id: 'b' + i, type: 'generator', generator: 'noise', blend: m, params: { type: 'perlin', scale: 80 },
      mask: { shape: 'rect', x: 0, y: i / 8, w: 1, h: 1 / 8 },
    })),
  ]) });
  list.push({ name: 'masks-torn', doc: doc([
    { id: 'p', type: 'generator', generator: 'solid', params: { color: '#F0F0EC' } },
    { id: 'q', type: 'generator', generator: 'solid', params: { color: '#1B2FD6' }, mask: { shape: 'combine', op: 'subtract', masks: [{ shape: 'ellipse', cx: 0.5, cy: 0.45, rx: 0.4, ry: 0.3, torn: 24 }, { shape: 'noise', scale: 60, threshold: 0.62 }] } },
  ]) });
  list.push({ name: 'ramp-progress-1', signals: { progress: 1 }, doc: doc([{ id: 'in', type: 'source', input: 'main' }, { id: 'fx', type: 'effect', effects: [{ id: 'e', effect: 'liquify', params: { amount: { ramp: [0, 200] } } }] }]), fixture: 'face' });
  for (const s of samples) for (const fx of ['blank', 'face']) list.push({ name: `sample-${s.name}-${fx}`, fixture: fx, doc: { ...s.doc, width: W, height: H } });
  return list;
}

let failed = 0, passed = 0, created = 0;
fs.mkdirSync(goldenDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

if (BENCH) {
  const results = [];
  for (const s of samples) {
    for (const [w, h] of [[1080, 1920], [720, 480]]) {
      // scrub the first numeric parameter found in any layer's effect stack
      let firstFx = {}, fx, scrubParam;
      for (const l of s.doc.layers) for (const e of l.effects ?? []) {
        const k = Object.keys(e.params ?? {}).find((k) => typeof e.params[k] === 'number');
        if (k && !fx) { firstFx = l; fx = e; scrubParam = k; }
      }
      const r = await page.evaluate(([d, o]) => window.shard.bench(d, o), [{ ...s.doc, width: w, height: h }, { fixture: 'face', frames: 5, scrub: fx && scrubParam ? { layer: firstFx.id, effect: fx.id, param: scrubParam, values: [fx.params[scrubParam] * 0.9, fx.params[scrubParam] * 1.1, fx.params[scrubParam]] } : undefined }]);
      results.push({ sample: s.name, size: `${w}×${h}`, ...r });
      console.log(`${s.name} ${w}×${h}: cold ${r.cold.toFixed(1)} ms · cached ${r.cached.toFixed(2)} ms · scrub one effect ${r.scrub.toFixed(1)} ms · live frame ${r.live.toFixed(1)} ms · scrubbed ${firstFx.id}/${fx?.effect}.${scrubParam}  [${r.renderer}]`);
    }
  }
  fs.writeFileSync(path.join(outDir, 'bench.json'), JSON.stringify(results, null, 2));
} else if (PROOF) {
  fs.mkdirSync(proofDir, { recursive: true });
  for (const s of samples) {
    for (const fx of ['blank', 'grey', 'gradient', 'face']) {
      // rendered at full size, saved as half-size JPEGs to keep the repo small
      const r = await page.evaluate(([d, o]) => window.shard.renderDoc(d, o), [s.doc, { fixture: fx, type: 'image/jpeg', scale: 0.5 }]);
      const file = path.join(proofDir, `${s.name}--${fx}.jpg`);
      fs.writeFileSync(file, Buffer.from(r.png.split(',')[1], 'base64'));
      console.log('proof', path.relative(root, file), `${r.stats.ms.toFixed(0)} ms`);
    }
  }
} else {
  const effects = await page.evaluate(() => window.shard.effects());
  const generators = await page.evaluate(() => window.shard.generators());
  for (const c of cases(effects, generators)) {
    if (only && !c.name.includes(only)) continue;
    let r;
    try {
      r = await page.evaluate(([d, o]) => window.shard.renderDoc(d, o), [c.doc, { fixture: c.fixture ?? 'blank', signals: c.signals }]);
    } catch (e) { failed++; console.log(`FAIL ${c.name}: ${String(e).split('\n').slice(0, 6).join('\n')}`); continue; }
    const png = decode(r.png);
    fs.writeFileSync(path.join(outDir, c.name + '.png'), PNG.sync.write(png));
    const gfile = path.join(goldenDir, c.name + '.png');
    if (UPDATE || !fs.existsSync(gfile)) { fs.writeFileSync(gfile, PNG.sync.write(png)); created++; continue; }
    const g = PNG.sync.read(fs.readFileSync(gfile));
    let diff = 0;
    if (g.width !== png.width || g.height !== png.height) diff = Infinity;
    else for (let i = 0; i < g.data.length; i += 4) {
      if (Math.abs(g.data[i] - png.data[i]) > TOL_CHANNEL || Math.abs(g.data[i + 1] - png.data[i + 1]) > TOL_CHANNEL || Math.abs(g.data[i + 2] - png.data[i + 2]) > TOL_CHANNEL || Math.abs(g.data[i + 3] - png.data[i + 3]) > TOL_CHANNEL) diff++;
    }
    const share = diff / (W * H);
    if (share > TOL_SHARE) { failed++; console.log(`FAIL ${c.name}: ${(share * 100).toFixed(2)}% of pixels differ (see engine/test/out/${c.name}.png)`); }
    else passed++;
  }
  // determinism: the same document twice must give identical pixels
  const det = cases([{ id: 'liquify' }], []).find((c) => c.name.startsWith('effect-liquify-face'));
  const a = await page.evaluate(([d, o]) => window.shard.renderDoc(d, o), [det.doc, { fixture: 'face' }]);
  const b = await page.evaluate(([d, o]) => window.shard.renderDoc(d, o), [det.doc, { fixture: 'face' }]);
  if (a.png !== b.png) { failed++; console.log('FAIL determinism: two renders of the same document differ'); } else passed++;
  console.log(`\n${passed} passed, ${failed} failed, ${created} goldens written`);
}

if (errors.length) console.log('\nBrowser console:\n' + [...new Set(errors)].slice(0, 20).join('\n'));
await browser.close();
await server.close();
process.exit(failed ? 1 : 0);
