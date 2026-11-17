// A thin WebGL2 wrapper: render targets (half-float when the GPU allows it,
// 8-bit otherwise), a target pool, a program cache with automatic uniform
// binding, and one full-screen triangle pair for every pass.

import { VERTEX, BLIT_FRAG } from './glsl-lib';

export interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
  float: boolean;
  id: number;
}

interface UniformInfo { loc: WebGLUniformLocation; type: number; size: number; unit?: number }
export interface Program { prog: WebGLProgram; uniforms: Map<string, UniformInfo>; samplers: string[] }

export type UniformValue = number | boolean | number[] | Float32Array | Int32Array | Target | WebGLTexture | null | undefined;

let targetIds = 0;

export class GPU {
  readonly gl: WebGL2RenderingContext;
  readonly canHalfFloat: boolean;
  readonly canFloat: boolean;
  private vao: WebGLVertexArrayObject;
  private programs = new Map<string, Program>();
  private pool: Target[] = [];
  private live = new Set<Target>();
  readonly stats = { passes: 0, programs: 0 };

  constructor(readonly canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false, alpha: true }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('Shard engine needs WebGL2, which this browser did not provide.');
    this.gl = gl;
    this.canFloat = !!gl.getExtension('EXT_color_buffer_float');
    this.canHalfFloat = this.canFloat || !!gl.getExtension('EXT_color_buffer_half_float');
    gl.getExtension('OES_texture_float_linear');
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.vao = vao;
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  }

  // ---------- targets ----------

  /** Get a render target from the pool (or a new one). precision 'float' needs half-float support. */
  acquire(w: number, h: number, precision: 'auto' | 'float' | 'byte' = 'auto'): Target {
    const wantFloat = precision === 'float' || (precision === 'auto' && this.canHalfFloat);
    const i = this.pool.findIndex((t) => t.w === w && t.h === h && t.float === (wantFloat && this.canHalfFloat));
    if (i >= 0) { const t = this.pool.splice(i, 1)[0]; this.live.add(t); return t; }
    const t = this.createTarget(w, h, wantFloat && this.canHalfFloat);
    this.live.add(t);
    return t;
  }
  release(t: Target | null | undefined) {
    if (!t || !this.live.has(t)) return;
    this.live.delete(t);
    this.pool.push(t);
    // Keep the pool bounded so a long session cannot grow GPU memory without limit.
    while (this.pool.length > 24) this.destroy(this.pool.shift()!);
  }
  destroy(t: Target) {
    this.gl.deleteTexture(t.tex);
    this.gl.deleteFramebuffer(t.fbo);
    this.live.delete(t);
  }
  get liveTargets() { return this.live.size; }

  private createTarget(w: number, h: number, float: boolean): Target {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.texParams(gl.LINEAR, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) {
      gl.deleteTexture(tex); gl.deleteFramebuffer(fbo);
      if (float) return this.createTarget(w, h, false);
      throw new Error(`Could not create a ${w}×${h} render target.`);
    }
    return { tex, fbo, w, h, float, id: ++targetIds };
  }

  private texParams(filter: number, wrap: number) {
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  }

  /** Upload an image/canvas/video into a (new or reused) target. Row 0 = top. */
  upload(source: TexImageSource, w: number, h: number, into?: Target): Target {
    const gl = this.gl;
    const t = into ?? this.acquire(w, h, 'byte');
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (t.float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, source);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    return t;
  }

  /** Upload raw float data (e.g. coefficient tables) to a small RGBA32F texture. */
  dataTexture(data: Float32Array, w: number, h: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data);
    this.texParams(gl.NEAREST, gl.CLAMP_TO_EDGE);
    return tex;
  }

  // ---------- programs ----------

  program(key: string, fragSrc: string): Program {
    let p = this.programs.get(key);
    if (p) return p;
    const gl = this.gl;
    const vs = this.compile(gl.VERTEX_SHADER, VERTEX, key);
    const fs = this.compile(gl.FRAGMENT_SHADER, fragSrc, key);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs); gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, 'a_pos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`Shader link failed (${key}): ${gl.getProgramInfoLog(prog)}`);
    gl.deleteShader(vs); gl.deleteShader(fs);
    const uniforms = new Map<string, UniformInfo>();
    const samplers: string[] = [];
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) as number;
    let unit = 0;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(prog, i)!;
      const name = info.name.replace(/\[0\]$/, '');
      const u: UniformInfo = { loc: gl.getUniformLocation(prog, info.name)!, type: info.type, size: info.size };
      if (info.type === gl.SAMPLER_2D) { u.unit = unit++; samplers.push(name); }
      uniforms.set(name, u);
    }
    p = { prog, uniforms, samplers };
    this.programs.set(key, p);
    this.stats.programs++;
    return p;
  }

  private compile(type: number, src: string, key: string): WebGLShader {
    const gl = this.gl;
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s) ?? '';
      const lines = src.split('\n');
      const m = /ERROR: \d+:(\d+)/.exec(log);
      const ctx = m ? lines.slice(Math.max(0, +m[1] - 3), +m[1] + 2).join('\n') : '';
      throw new Error(`Shader compile failed (${key}): ${log}\n${ctx}`);
    }
    return s;
  }

  /** Run one full-screen pass of `prog` into `target` (null = the canvas). */
  pass(prog: Program, target: Target | null, uniforms: Record<string, UniformValue>, w?: number, h?: number) {
    const gl = this.gl;
    const W = target ? target.w : (w ?? gl.drawingBufferWidth), H = target ? target.h : (h ?? gl.drawingBufferHeight);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(prog.prog);
    gl.bindVertexArray(this.vao);
    const all: Record<string, UniformValue> = { u_res: [W, H], ...uniforms };
    for (const [name, u] of prog.uniforms) {
      const v = all[name];
      if (u.unit !== undefined) {
        gl.activeTexture(gl.TEXTURE0 + u.unit);
        const tex = v && typeof v === 'object' && 'tex' in (v as object) ? (v as Target).tex : (v as WebGLTexture | null);
        gl.bindTexture(gl.TEXTURE_2D, tex ?? null);
        gl.uniform1i(u.loc, u.unit);
        continue;
      }
      if (v === undefined || v === null) continue;
      this.setUniform(u, v);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    this.stats.passes++;
  }

  private setUniform(u: UniformInfo, v: UniformValue) {
    const gl = this.gl, l = u.loc;
    const arr = (n: number) => {
      const a = typeof v === 'number' || typeof v === 'boolean' ? [Number(v)] : Array.from(v as ArrayLike<number>);
      const out = new Float32Array(n * u.size);
      for (let i = 0; i < out.length && i < a.length; i++) out[i] = a[i];
      return out;
    };
    const iarr = (n: number) => Int32Array.from(arr(n), (x) => Math.round(x));
    switch (u.type) {
      case gl.FLOAT: gl.uniform1fv(l, arr(1)); break;
      case gl.FLOAT_VEC2: gl.uniform2fv(l, arr(2)); break;
      case gl.FLOAT_VEC3: gl.uniform3fv(l, arr(3)); break;
      case gl.FLOAT_VEC4: gl.uniform4fv(l, arr(4)); break;
      case gl.INT: case gl.BOOL: gl.uniform1iv(l, iarr(1)); break;
      case gl.INT_VEC2: gl.uniform2iv(l, iarr(2)); break;
      case gl.UNSIGNED_INT: gl.uniform1uiv(l, Uint32Array.from(arr(1), (x) => x >>> 0)); break;
      case gl.FLOAT_MAT3: gl.uniformMatrix3fv(l, false, arr(9)); break;
      case gl.FLOAT_MAT4: gl.uniformMatrix4fv(l, false, arr(16)); break;
      default: break;
    }
  }

  /** Draw a target to the visible canvas (y flipped), optionally over a checkerboard. */
  blit(t: Target, checker = false) {
    const p = this.program('__blit', BLIT_FRAG);
    this.pass(p, null, { u_src: t, u_checker: checker ? 1 : 0 });
  }

  /** Read a target's pixels as RGBA8, row 0 = top. */
  read(t: Target): Uint8Array {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    let out: Uint8Array;
    if (t.float) {
      // Half-float targets read back as RGBA/FLOAT, then quantize.
      const f = new Float32Array(t.w * t.h * 4);
      gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.FLOAT, f);
      out = new Uint8Array(f.length);
      for (let i = 0; i < f.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(f[i] * 255)));
    } else {
      out = new Uint8Array(t.w * t.h * 4);
      gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out;
  }

  /** Block until the GPU has finished: read back one pixel (gl.finish alone does not wait on every driver). */
  finish(t?: Target | null) {
    const gl = this.gl;
    if (t) gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    const px = t?.float ? new Float32Array(4) : new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, t?.float ? gl.FLOAT : gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}
