// Public entry point: load a document, set inputs and signals, render.
import { GPU, type Target } from './gl/gpu';
import { Renderer, type InputSource, type RenderStats } from './renderer';
import { validateDocument, type ShardDocument } from './doc';

export interface EngineOptions {
  /** Where the bundled fonts live (Courier Prime, IBM Plex Mono, VT323). */
  fontBase?: string;
}

export const FONTS: [string, string, FontFaceDescriptors?][] = [
  ['Courier Prime', 'CourierPrime-Regular.ttf'],
  ['Courier Prime', 'CourierPrime-Bold.ttf', { weight: '700' }],
  ['IBM Plex Mono', 'IBMPlexMono-Regular.ttf'],
  ['VT323', 'VT323-Regular.ttf'],
];

let fontsLoaded: Promise<void> | null = null;
export function loadFonts(base = './fonts/'): Promise<void> {
  if (fontsLoaded) return fontsLoaded;
  const fontSet = (globalThis as any).document?.fonts ?? (globalThis as any).fonts;
  if (!fontSet) return (fontsLoaded = Promise.resolve());
  fontsLoaded = Promise.all(
    FONTS.map(async ([family, file, desc]) => {
      try {
        const f = new FontFace(family, `url(${base}${file})`, desc);
        await f.load();
        fontSet.add(f);
      } catch (e) {
        // A missing font falls back visibly rather than failing the render.
        console.warn(`[shard] font ${family} (${file}) failed to load; falling back.`, e);
      }
    }),
  ).then(() => undefined);
  return fontsLoaded;
}

export class ShardEngine {
  readonly gpu: GPU;
  readonly renderer: Renderer;
  doc: ShardDocument | null = null;
  private inputs = new Map<string, InputSource>();
  private assets = new Map<string, ImageBitmap>();
  private last: Target | null = null;
  signals: Record<string, number> = { progress: 0 };

  constructor(readonly canvas: HTMLCanvasElement | OffscreenCanvas, private opts: EngineOptions = {}) {
    this.gpu = new GPU(canvas);
    this.renderer = new Renderer(this.gpu);
  }

  static async create(canvas: HTMLCanvasElement | OffscreenCanvas, opts: EngineOptions = {}) {
    await loadFonts(opts.fontBase);
    return new ShardEngine(canvas, opts);
  }

  async load(json: unknown): Promise<ShardDocument> {
    const doc = validateDocument(typeof json === 'string' ? JSON.parse(json) : json);
    this.assets.clear();
    for (const [id, a] of Object.entries(doc.assets ?? {})) {
      const blob = await (await fetch(a.src)).blob();
      this.assets.set(id, await createImageBitmap(blob));
    }
    if (this.doc && (this.doc.width !== doc.width || this.doc.height !== doc.height)) this.renderer.clearCache();
    this.doc = doc;
    this.signals = { progress: 0, ...(doc.signals ?? {}), ...this.signals };
    this.canvas.width = doc.width;
    this.canvas.height = doc.height;
    return doc;
  }

  /** Replace the document without reloading assets (for editing). */
  update(doc: ShardDocument) {
    this.doc = validateDocument(doc);
  }

  /** Attach a picture, canvas or video to a named input. Frames are never stored in the document. */
  setInput(name: string, source: TexImageSource | null, width?: number, height?: number) {
    const prev = this.inputs.get(name);
    const w = width ?? (source as any)?.videoWidth ?? (source as any)?.naturalWidth ?? (source as any)?.width ?? 0;
    const h = height ?? (source as any)?.videoHeight ?? (source as any)?.naturalHeight ?? (source as any)?.height ?? 0;
    this.inputs.set(name, { source, width: w, height: h, version: (prev?.version ?? 0) + 1 });
  }
  /** Mark a live input as having a new frame. */
  touchInput(name: string) {
    const i = this.inputs.get(name);
    if (i) i.version++;
  }

  setSignal(name: string, value: number) { this.signals[name] = value; }

  render(time = 0): RenderStats {
    if (!this.doc) throw new Error('No document loaded.');
    this.last = this.renderer.render(this.doc, { time, signals: this.signals, inputs: this.inputs, assets: this.assets as any });
    return this.renderer.stats;
  }

  /** Show the last render on the canvas. */
  present(checker = true) {
    if (this.last) this.gpu.blit(this.last, checker);
  }

  /** RGBA8 pixels of the last render, row 0 = top. */
  pixels(): Uint8Array {
    if (!this.last) throw new Error('Nothing rendered yet.');
    return this.gpu.read(this.last);
  }

  async toPNG(): Promise<Blob> {
    const px = this.pixels();
    const { width: w, height: h } = this.doc!;
    const c = new OffscreenCanvas(w, h);
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px.buffer as ArrayBuffer), w, h), 0, 0);
    return c.convertToBlob({ type: 'image/png' });
  }
}
