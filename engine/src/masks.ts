// Masks place every effect. Shape masks (ellipse, rect, polygon) are drawn
// with Canvas 2D so they can be torn (roughened into a paper edge) and
// feathered; procedural masks (noise, luma, bands) run on the GPU. Masks
// combine with add / subtract / intersect. All coordinates are fractions of
// the canvas (0..1); torn and feather are in px at 1080 scale.

import type { Mask } from './doc';
import type { GPU, Target } from './gl/gpu';
import { PRELUDE } from './gl/glsl-lib';
import { rng } from './util';

const PROC_FRAG = /* glsl */ `${PRELUDE}
uniform sampler2D u_src;
uniform int u_kind; // 0 noise, 1 luma, 2 bands
uniform float u_scale, u_threshold, u_softness, u_lo, u_hi, u_angle, u_duty, u_jitter;
uniform int u_octaves, u_ntype, u_count;
uniform bool u_invert;
void main() {
  vec2 p = gl_FragCoord.xy; float m;
  if (u_kind == 0) {
    vec2 q = p / (u_scale * u_unit); float n;
    if (u_ntype == 1) { vec3 w = worley(q, u_seed); n = clamp(w.y - w.x, 0.0, 1.0) * 1.6; }
    else if (u_ntype == 2) n = vnoise(q, u_seed);
    else n = fbm(q, u_octaves, u_seed) * 0.5 + 0.5;
    m = smoothstep(u_threshold - u_softness, u_threshold + u_softness + 1e-4, n);
  } else if (u_kind == 1) {
    float l = lum(texture(u_src, p / u_res).rgb);
    m = smoothstep(u_lo - u_softness, u_lo + u_softness + 1e-4, l) * (1.0 - smoothstep(u_hi - u_softness, u_hi + u_softness + 1e-4, l));
  } else {
    vec2 d = vec2(-sin(radians(u_angle)), cos(radians(u_angle)));
    float t = dot(p / u_res - 0.5, d) * float(u_count);
    int i = int(floor(t));
    float f = fract(t + (hash1(i, u_seed) - 0.5) * u_jitter);
    m = step(f, u_duty * (0.5 + hash1(i, u_seed ^ 5u)));
  }
  if (u_invert) m = 1.0 - m;
  o_color = vec4(m, m, m, 1.0);
}`;

const COMBINE_FRAG = /* glsl */ `${PRELUDE}
uniform sampler2D u_a; uniform sampler2D u_b; uniform int u_op; uniform bool u_invert;
void main() {
  float a = texture(u_a, gl_FragCoord.xy / u_res).r, b = texture(u_b, gl_FragCoord.xy / u_res).r;
  float m = u_op == 0 ? max(a, b) : u_op == 1 ? a * (1.0 - b) : a * b;
  if (u_invert) m = 1.0 - m;
  o_color = vec4(m, m, m, 1.0);
}`;

type Pt = [number, number];

function shapePoints(m: Mask, w: number, h: number): Pt[] {
  if (m.shape === 'ellipse') {
    const n = 180, a = ((m.angle ?? 0) * Math.PI) / 180, pts: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2, x = Math.cos(t) * m.rx * w, y = Math.sin(t) * m.ry * h;
      pts.push([m.cx * w + x * Math.cos(a) - y * Math.sin(a), m.cy * h + x * Math.sin(a) + y * Math.cos(a)]);
    }
    return pts;
  }
  if (m.shape === 'rect') {
    const a = ((m.angle ?? 0) * Math.PI) / 180, cx = (m.x + m.w / 2) * w, cy = (m.y + m.h / 2) * h;
    return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as Pt[]).map(([sx, sy]) => {
      const x = (sx * m.w * w) / 2, y = (sy * m.h * h) / 2;
      return [cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a)] as Pt;
    });
  }
  if (m.shape === 'poly') {
    const pts: Pt[] = [];
    for (let i = 0; i + 1 < m.points.length; i += 2) pts.push([m.points[i] * w, m.points[i + 1] * h]);
    return pts;
  }
  return [];
}

/** Roughen a closed outline into a torn edge: fine jitter plus slower bites. */
function tear(pts: Pt[], rough: number, seed: number, unit: number): Pt[] {
  const r = rng(seed), out: Pt[] = [];
  const step = 5 * unit;
  let bite = 0, biteLeft = 0;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
    const len = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.round(len / step));
    const nx = -(by - ay) / (len || 1), ny = (bx - ax) / (len || 1);
    for (let k = 0; k < n; k++) {
      if (biteLeft <= 0) { bite = (r() - 0.6) * rough * 2.2; biteLeft = 3 + r() * 14; }
      biteLeft--;
      const t = k / n, j = (r() - 0.5) * rough + bite;
      out.push([ax + (bx - ax) * t + nx * j, ay + (by - ay) * t + ny * j]);
    }
  }
  return out;
}

export class MaskRenderer {
  constructor(private gpu: GPU) {}

  /** Render a mask to a new target (caller releases). `content` is the layer, for luma masks. */
  render(m: Mask, w: number, h: number, seed: number, content: Target | null): Target {
    const unit = Math.min(w, h) / 1080;
    const s = (m.seed ?? seed) >>> 0;
    if (m.shape === 'combine') {
      const parts = m.masks.map((x, i) => this.render(x, w, h, seed + i * 101, content));
      if (!parts.length) return this.fill(w, h, m.invert ? 1 : 0);
      let acc = parts[0];
      const prog = this.gpu.program('mask/combine', COMBINE_FRAG);
      for (let i = 1; i < parts.length; i++) {
        const out = this.gpu.acquire(w, h, 'byte');
        this.gpu.pass(prog, out, { u_a: acc, u_b: parts[i], u_op: ['add', 'subtract', 'intersect'].indexOf(m.op), u_invert: i === parts.length - 1 && m.invert ? 1 : 0, u_unit: unit });
        this.gpu.release(acc); this.gpu.release(parts[i]);
        acc = out;
      }
      return acc;
    }
    if (m.shape === 'noise' || m.shape === 'luma' || m.shape === 'bands') {
      const out = this.gpu.acquire(w, h, 'byte');
      const prog = this.gpu.program('mask/proc', PROC_FRAG);
      const q = m as any;
      this.gpu.pass(prog, out, {
        u_src: content, u_unit: unit, u_seed: s, u_kind: ['noise', 'luma', 'bands'].indexOf(m.shape),
        u_scale: q.scale ?? 200, u_threshold: q.threshold ?? 0.5, u_softness: q.softness ?? 0.04, u_octaves: q.octaves ?? 4,
        u_ntype: ['perlin', 'worley', 'value'].indexOf(q.type ?? 'perlin'), u_lo: q.lo ?? 0.5, u_hi: q.hi ?? 1.01,
        u_angle: q.angle ?? 0, u_duty: q.duty ?? 0.5, u_jitter: q.jitter ?? 0.3, u_count: q.count ?? 12, u_invert: m.invert ? 1 : 0,
      });
      return out;
    }
    // shape masks on a canvas
    const c = new OffscreenCanvas(w, h), ctx = c.getContext('2d')!;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    let pts = shapePoints(m, w, h);
    if (m.torn && m.torn > 0) pts = tear(pts, m.torn * unit, s, unit);
    if (m.feather && m.feather > 0) ctx.filter = `blur(${m.feather * unit}px)`;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath(); ctx.fill();
    if (m.invert) { ctx.filter = 'none'; ctx.globalCompositeOperation = 'difference'; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
    return this.gpu.upload(c, w, h);
  }

  fill(w: number, h: number, v: number): Target {
    const c = new OffscreenCanvas(w, h), ctx = c.getContext('2d')!;
    ctx.fillStyle = v ? '#fff' : '#000'; ctx.fillRect(0, 0, w, h);
    return this.gpu.upload(c, w, h);
  }
}
