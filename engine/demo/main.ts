// Minimal page that renders a Shard document from JSON (Phase 1).
import { ShardEngine, type ShardDocument } from '../src';
import { fixture, type FixtureName } from '../test/fixtures';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('c');
const SAMPLES = ['porcelain-glitch', 'stretched-signage'];
const engine = await ShardEngine.create(canvas, { fontBase: './fonts/' });
let doc: ShardDocument | null = null;
let video: HTMLVideoElement | null = null;
let raf = 0, t0 = performance.now();

for (const s of SAMPLES) $<HTMLSelectElement>('sample').add(new Option(s, s));

function showError(e: unknown) { $('err').textContent = e instanceof Error ? e.message : String(e); }

async function open(json: unknown) {
  try {
    $('err').textContent = '';
    doc = await engine.load(json);
    $<HTMLInputElement>('seed').value = String(doc.seed);
    $<HTMLInputElement>('progress').value = String(doc.signals?.progress ?? 1);
    await setInput();
  } catch (e) { showError(e); }
}

async function setInput() {
  if (!doc) return;
  const v = $<HTMLSelectElement>('input').value;
  if (video) { (video.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop()); video = null; }
  if (v === 'webcam') {
    try {
      video = document.createElement('video');
      video.muted = true; video.playsInline = true;
      video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
      await video.play();
      engine.setInput('main', video);
    } catch (e) { showError(e); }
  } else if (v === 'image') {
    $<HTMLInputElement>('imgfile').click();
    return;
  } else engine.setInput('main', fixture(v as FixtureName, doc.width, doc.height));
  draw();
}

function draw() {
  cancelAnimationFrame(raf);
  if (!doc) return;
  const live = !!video || $<HTMLInputElement>('animate').checked;
  const frame = () => {
    engine.setSignal('progress', +$<HTMLInputElement>('progress').value);
    $('pv').textContent = $<HTMLInputElement>('progress').value;
    engine.renderer.profile = $<HTMLInputElement>('profile').checked;
    if (video) engine.touchInput('main');
    try {
      const s = engine.render((performance.now() - t0) / 1000);
      engine.present(true);
      const nodes = s.nodes.filter((n) => !n.cached).sort((a, b) => b.ms - a.ms).slice(0, 14);
      $('stats').textContent = `${doc!.width}×${doc!.height}\nframe ${s.ms.toFixed(1)} ms · ${s.rendered} rendered · ${s.cached} cached\n\n` +
        (engine.renderer.profile ? nodes.map((n) => `${n.ms.toFixed(1).padStart(6)} ms  ${n.label}`).join('\n') : '');
    } catch (e) { showError(e); return; }
    if (live) raf = requestAnimationFrame(frame);
  };
  frame();
}

$('sample').addEventListener('change', async (e) => open(await (await fetch(`./samples/${(e.target as HTMLSelectElement).value}.json`)).json()));
$('file').addEventListener('change', async (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) open(await f.text()); });
$('imgfile').addEventListener('change', async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
  engine.setInput('main', await createImageBitmap(f)); draw();
});
$('input').addEventListener('change', setInput);
$('progress').addEventListener('input', draw);
$('animate').addEventListener('change', draw);
$('profile').addEventListener('change', draw);
$('seed').addEventListener('change', () => { if (doc) { doc.seed = +$<HTMLInputElement>('seed').value; draw(); } });
$('reseed').addEventListener('click', () => { if (doc) { doc.seed = (Math.random() * 1e9) | 0; $<HTMLInputElement>('seed').value = String(doc.seed); draw(); } });
$('png').addEventListener('click', async () => {
  const a = document.createElement('a'); a.href = URL.createObjectURL(await engine.toPNG()); a.download = `${doc?.name ?? 'shard'}.png`; a.click();
});

await open(await (await fetch(`./samples/${SAMPLES[0]}.json`)).json());
