// Pixel and signal damage: slices (shelves + window bars), block mosh,
// GPU JPEG crush (real 8×8 DCT quantisation), RGB split.
import { P } from '../params';
import type { EffectDef } from '../nodes';
import { paramUniforms } from '../nodes';
import { rng } from '../util';
import { PRELUDE, EFFECT_PRELUDE } from '../gl/glsl-lib';

const MAX_BANDS = 32;

export const slices: EffectDef = {
  id: 'slices',
  name: 'Slices',
  category: 'damage',
  description: 'Bands copied sideways and outlined, some replaced by stacked window title bars like shelves (ref 02).',
  live: true,
  params: [
    P.int('count', 12, 1, MAX_BANDS),
    P.rect('region', [0.45, 0.15, 0.55, 0.45], { description: 'Area the bands start in (x, y, w, h).' }),
    P.px('minHeight', 10, 2, 200),
    P.px('maxHeight', 44, 2, 400),
    P.px('maxShift', 180, 0, 1000),
    P.float('bias', 0.4, -1, 1, { description: '-1 shifts left, 1 shifts right.' }),
    P.float('bars', 0.5, 0, 1, { description: 'Chance a band becomes a window title bar.' }),
    P.float('stack', 0.6, 0, 1, { description: 'How much bands stack into neat shelves.' }),
    P.color('outline', '#F0F0EC'),
    P.px('outlineWidth', 2, 0, 12),
    P.color('barColor', '#1B2FD6'),
    P.color('barLight', '#F0F0EC'),
    P.color('buttonColor', '#D8D1BA'),
    P.px('shadow', 4, 0, 30),
  ],
  decl: `uniform vec4 u_bands[${MAX_BANDS}]; uniform vec4 u_bandInfo[${MAX_BANDS}]; uniform int u_n;`,
  uniforms: (v, info) => {
    const r = rng(info.seed);
    const [rx, ry, rw, rh] = v.region as number[];
    const bands: number[] = [], meta: number[] = [];
    const n = Math.min(MAX_BANDS, v.count | 0);
    let shelfY = ry * info.h;
    for (let i = 0; i < n; i++) {
      const bh = (v.minHeight + r() * (v.maxHeight - v.minHeight)) * info.unit;
      // "stack" places bands one under another like shelves instead of scattering them.
      const scatterY = ry * info.h + r() * Math.max(1, rh * info.h - bh);
      const by = r() < v.stack ? shelfY : scatterY;
      shelfY = by + bh * (1.15 + r() * 0.9);
      if (shelfY > (ry + rh) * info.h) shelfY = ry * info.h + r() * rh * info.h * 0.3;
      const bx = (rx + r() * rw * 0.3) * info.w;
      const bw = rw * info.w * (0.45 + r() * 0.55);
      const shift = (r() - 0.5 + v.bias * 0.5) * 2 * v.maxShift * info.unit;
      bands.push(bx, by, bw, bh);
      meta.push(shift, r() < v.bars ? 1 : 0, r() * 1000, r());
    }
    return { u_bands: bands, u_bandInfo: meta, u_n: n };
  },
  glsl: /* glsl */ `
bool inRect(vec2 p, vec4 r) { return p.x >= r.x && p.y >= r.y && p.x < r.x + r.z && p.y < r.y + r.w; }
vec4 titleBar(vec2 l, vec2 s, float key) {
  float u = u_unit;
  vec3 c = mix(u_barColor.rgb * 0.45, u_barColor.rgb, clamp(l.x / s.x * 1.6, 0.0, 1.0));
  float bw = max(1.0, s.y / 14.0);
  if (l.x < bw || l.y < bw || l.x > s.x - bw || l.y > s.y - bw) c = u_barLight.rgb;
  // three boxes at the right end
  float b = s.y * 0.62, by = (s.y - b) * 0.5;
  for (int k = 0; k < 3; k++) {
    float bx = s.x - float(k + 1) * (b + 4.0 * u) - 4.0 * u;
    vec2 q = l - vec2(bx, by);
    if (q.x >= 0.0 && q.y >= 0.0 && q.x < b && q.y < b) {
      c = u_buttonColor.rgb;
      if (q.x < 1.0 * u + 0.5 || q.y < 1.0 * u + 0.5 || q.x > b - u - 0.5 || q.y > b - u - 0.5) c = vec3(0.02);
      if (k == 0 && abs(abs(q.x - b * 0.5) - abs(q.y - b * 0.5)) < 0.9 * u && abs(q.x - b * 0.5) < b * 0.28) c = vec3(0.02);
      if (k == 1 && q.y > b * 0.3 && q.y < b * 0.3 + 1.6 * u && q.x > b * 0.22 && q.x < b * 0.78) c = vec3(0.02);
      if (k == 2 && q.y > b * 0.68 && q.y < b * 0.68 + 1.6 * u && q.x > b * 0.22 && q.x < b * 0.6) c = vec3(0.02);
    }
  }
  // blocky title "text": cells switched on by hash, never real letters
  float gx = s.y * 0.42, cw = s.y * 0.38;
  if (key > 500.0 && l.x > gx && l.x < gx + s.x * 0.32) {
    int cell = int((l.x - gx) / cw);
    float on = hash1(cell, uint(key));
    float cx = mod(l.x - gx, cw);
    if (on > 0.25 && cx < cw * 0.72 && l.y > s.y * 0.3 && l.y < s.y * (0.62 + 0.1 * on)) c = u_barLight.rgb;
  }
  return vec4(c, 1.0);
}
vec4 effect(vec2 p) {
  vec4 col = src(p);
  for (int i = 0; i < ${MAX_BANDS}; i++) {
    if (i >= u_n) break;
    vec4 r = u_bands[i]; vec4 m = u_bandInfo[i];
    vec4 rs = vec4(r.x + m.x, r.y, r.z, r.w);
    float sh = u_shadow * u_unit;
    if (!inRect(p, rs) && inRect(p - vec2(sh), rs)) col.rgb *= 0.35;
    if (inRect(p, rs)) {
      vec2 l = p - rs.xy;
      if (m.y > 0.5) col = titleBar(l, rs.zw, m.z);
      else {
        col = src(p - vec2(m.x, 0.0));
        float ow = u_outlineWidth * u_unit;
        if (ow > 0.0 && (l.x < ow || l.y < ow || l.x > rs.z - ow || l.y > rs.w - ow)) col = vec4(u_outline.rgb, 1.0);
      }
    }
  }
  return col;
}`,
};

export const mosh: EffectDef = {
  id: 'mosh',
  name: 'Block mosh',
  category: 'damage',
  description: 'Blocks copied from a little way off, in horizontal runs, so the picture slips in squares.',
  live: true,
  params: [
    P.px('block', 24, 4, 160),
    P.float('probability', 0.1, 0, 1),
    P.int('reach', 3, 0, 16, { description: 'How many blocks away the copy comes from.' }),
    P.int('run', 3, 1, 8, { description: 'Longest horizontal run of moshed blocks.' }),
    P.float('channelDrift', 0.3, 0, 1, { description: 'Colour channels slip apart inside moshed blocks.' }),
    P.px('crunch', 0, 0, 16, { description: 'Pixelate inside moshed blocks.' }),
    P.float('rate', 0, 0, 30, { description: 'Re-roll the blocks this many times a second.' }),
  ],
  animated: (v) => v.rate > 0,
  glsl: /* glsl */ `
vec4 effect(vec2 p) {
  float bs = max(2.0, u_block * u_unit);
  ivec2 b = ivec2(floor(p / bs));
  uint s = u_seed + uint(floor(u_time * u_rate)) * 7919u;
  for (int k = 0; k < 8; k++) {
    if (k >= u_run) break;
    ivec2 bk = b - ivec2(k, 0);
    if (hashf(bk, s) < u_probability && float(k) < 1.0 + hashf(bk, s ^ 3u) * float(u_run)) {
      vec2 h = hash2(bk, s ^ 11u);
      vec2 off = vec2(floor((h.x - 0.5) * 2.0 * float(u_reach) + 0.5), floor((h.y - 0.3) * float(u_reach) + 0.5)) * bs;
      vec2 q = p + off;
      if (u_crunch > 0.0) { float c = u_crunch * u_unit; q = (floor(q / c) + 0.5) * c; }
      vec4 col = src(q);
      float dr = u_channelDrift * bs * 0.25 * (hashf(bk, s ^ 5u) - 0.5);
      col.r = src(q + vec2(dr, 0)).r; col.b = src(q - vec2(dr, 0)).b;
      return col;
    }
  }
  return src(p);
}`,
};

// ---------- JPEG crush on the GPU: forward DCT → quantise → inverse DCT ----------

const QL = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const QC = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99];
function qtable(base: number[], quality: number): number[] {
  const q = Math.max(1, Math.min(100, quality));
  const S = q < 50 ? 5000 / q : 200 - 2 * q;
  return base.map((b) => Math.max(1, Math.min(255, Math.floor((b * S + 50) / 100))));
}

const DCT_FWD = /* glsl */ `
uniform float u_ql[64]; uniform float u_qc[64]; uniform float u_glitch; uniform int u_chroma; uniform vec2 u_offset;
vec3 ycc(vec3 c) { c *= 255.0; return vec3(0.299 * c.r + 0.587 * c.g + 0.114 * c.b - 128.0, -0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b, 0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b); }
void main() {
  vec2 p = gl_FragCoord.xy - u_offset;
  ivec2 blk = ivec2(floor(p / 8.0)); ivec2 uv = ivec2(floor(mod(p, 8.0)));
  vec3 acc = vec3(0);
  for (int y = 0; y < 8; y++) for (int x = 0; x < 8; x++) {
    vec2 sp = vec2(blk * 8 + ivec2(x, y)) + 0.5 + u_offset;
    vec3 c = ycc(src(sp).rgb);
    if (u_chroma == 1) { vec2 cp = (floor(sp / 2.0) * 2.0) + 1.0; c.yz = ycc(src(cp).rgb).yz; }
    float cx = cos((2.0 * float(x) + 1.0) * float(uv.x) * PI / 16.0), cy = cos((2.0 * float(y) + 1.0) * float(uv.y) * PI / 16.0);
    acc += c * cx * cy;
  }
  float cu = uv.x == 0 ? 0.70710678 : 1.0, cv = uv.y == 0 ? 0.70710678 : 1.0;
  acc *= 0.25 * cu * cv;
  int k = uv.y * 8 + uv.x;
  vec3 q = vec3(u_ql[k], u_qc[k], u_qc[k]);
  vec3 coeff = floor(acc / q + 0.5) * q;
  // glitch: some blocks lose or swap coefficients, like a corrupted stream
  float g = hashf(blk, u_seed);
  if (g < u_glitch) {
    if (k == 0) coeff.yz += (hash2(blk, u_seed ^ 9u) - 0.5) * 240.0;
    else if (hashf(blk, u_seed ^ 4u) < 0.5) coeff *= 2.5;
    else coeff = coeff.zxy;
  }
  o_color = vec4(coeff / 1024.0, 1.0);
}`;
const DCT_INV = /* glsl */ `
uniform sampler2D u_coef; uniform vec2 u_offset;
vec3 rgbOf(vec3 y) { y.x += 128.0; return vec3(y.x + 1.402 * y.z, y.x - 0.344136 * y.y - 0.714136 * y.z, y.x + 1.772 * y.y) / 255.0; }
void main() {
  vec2 p = gl_FragCoord.xy - u_offset;
  ivec2 blk = ivec2(floor(p / 8.0)); ivec2 xy = ivec2(floor(mod(p, 8.0)));
  vec3 acc = vec3(0);
  for (int v = 0; v < 8; v++) for (int u = 0; u < 8; u++) {
    ivec2 cp = ivec2(vec2(blk * 8 + ivec2(u, v)) + u_offset);
    vec3 F = texelFetch(u_coef, clamp(cp, ivec2(0), ivec2(u_res) - 1), 0).rgb * 1024.0;
    float cu = u == 0 ? 0.70710678 : 1.0, cv = v == 0 ? 0.70710678 : 1.0;
    acc += cu * cv * F * cos((2.0 * float(xy.x) + 1.0) * float(u) * PI / 16.0) * cos((2.0 * float(xy.y) + 1.0) * float(v) * PI / 16.0);
  }
  acc *= 0.25;
  o_color = vec4(clamp(rgbOf(acc), 0.0, 1.0), src(gl_FragCoord.xy).a);
}`;

export const jpeg: EffectDef = {
  id: 'jpeg',
  name: 'JPEG crush (GPU)',
  category: 'damage',
  description: 'Real 8×8 DCT quantisation in shaders, fast enough for live use, with optional stream corruption.',
  live: true,
  params: [
    P.float('quality', 8, 1, 100),
    P.int('passes', 1, 1, 4, { description: 'Re-encode passes (each shifts the block grid by a pixel).' }),
    P.enum('chroma', '4:2:0', ['4:4:4', '4:2:0']),
    P.float('glitch', 0, 0, 1, { description: 'Chance a block is corrupted.' }),
  ],
  render: (rc) => {
    const { gpu, w, h } = rc;
    const fwd = gpu.program('jpeg/fwd', `${PRELUDE}${EFFECT_PRELUDE}${DCT_FWD}`);
    const inv = gpu.program('jpeg/inv', `${PRELUDE}${EFFECT_PRELUDE}${DCT_INV}`);
    const ql = qtable(QL, rc.values.quality), qc = qtable(QC, rc.values.quality);
    let cur = rc.input;
    const passes = Math.max(1, rc.values.passes | 0);
    for (let i = 0; i < passes; i++) {
      const coef = gpu.acquire(w, h, 'float');
      const common = { u_unit: rc.unit, u_time: rc.time, u_seed: rc.seed + i * 31, u_offset: [i % 2, (i >> 1) % 2] };
      gpu.pass(fwd, coef, { ...common, u_src: cur, u_ql: ql, u_qc: qc, u_glitch: rc.values.glitch, u_chroma: rc.values.chroma === '4:2:0' ? 1 : 0 });
      const out = gpu.acquire(w, h);
      gpu.pass(inv, out, { ...common, u_src: cur, u_coef: coef });
      gpu.release(coef);
      if (cur !== rc.input) gpu.release(cur);
      cur = out;
    }
    return cur;
  },
};

export const rgbSplit: EffectDef = {
  id: 'rgbSplit',
  name: 'RGB split',
  category: 'damage',
  description: 'Red and blue channels pulled apart, linearly or outward from a centre.',
  live: true,
  params: [
    P.enum('mode', 'linear', ['linear', 'radial']),
    P.px('dx', 6, -100, 100),
    P.px('dy', 0, -100, 100),
    P.float('radial', 0.012, 0, 0.1, { description: 'Radial strength (fraction of distance from centre).' }),
    P.vec2('center', [0.5, 0.45]),
    P.float('green', 0, -1, 1, { description: 'Move green too, by this share of the offset.' }),
  ],
  glsl: /* glsl */ `
vec4 effect(vec2 p) {
  vec2 off = u_mode == 0 ? vec2(u_dx, u_dy) * u_unit : (p - u_center * u_res) * u_radial;
  vec4 c = src(p);
  c.r = src(p + off).r; c.g = src(p + off * u_green).g; c.b = src(p - off).b;
  return c;
}`,
};

export { paramUniforms };
