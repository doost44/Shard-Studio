// Warp and geometry: liquify (melt), plane (perspective), stretch (pixel streaks).
import { P } from '../params';
import type { EffectDef } from '../nodes';

export const liquify: EffectDef = {
  id: 'liquify',
  name: 'Liquify',
  category: 'warp',
  description: 'Melt along a slow, multi-octave noise field, advected in steps so it flows like ref 02.',
  live: true,
  params: [
    P.px('amount', 70, 0, 600, { description: 'How far pixels travel along the field.' }),
    P.px('scale', 220, 8, 1200, { description: 'Size of the swirls.' }),
    P.int('octaves', 3, 1, 6),
    P.float('swirl', 0.6, 0, 1, { description: 'Rotates the flow: 0 pushes, 1 circles.' }),
    P.float('drift', 0, 0, 2, { description: 'Animation speed of the field.' }),
    P.float('anisotropy', 0, 0, 1, { description: 'Stretch the swirls along the angle.' }),
    P.deg('angle', 0),
    P.int('steps', 6, 1, 12, { description: 'Advection steps: more = smoother, longer streaks.' }),
  ],
  animated: (v) => v.drift > 0,
  glsl: /* glsl */ `
vec2 field(vec2 p) {
  vec2 q = p / (u_scale * u_unit);
  mat2 R = rot2(radians(u_angle));
  q = R * q; q.x /= (1.0 + u_anisotropy * 4.0); q = transpose(R) * q;
  float t = u_time * u_drift;
  float a = fbm(q + vec2(t * 0.31, t * 0.17), u_octaves, u_seed);
  float b = fbm(q + vec2(19.1, 7.3) - vec2(t * 0.21, t * 0.29), u_octaves, u_seed + 7919u);
  return rot2(u_swirl * 1.5708) * vec2(a, b);
}
vec4 effect(vec2 p) {
  vec2 q = p;
  float st = u_amount * u_unit / float(u_steps);
  for (int i = 0; i < 12; i++) { if (i >= u_steps) break; q += field(q) * st * 1.6; }
  return src(q);
}`,
};

// --- plane: map the input onto a four-point quad (homography) ---

type V2 = [number, number];
/** Homography from the unit square to quad [tl, tr, br, bl] (column-major mat3). */
function squareToQuad(q: V2[]): number[] {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let a, b, c, d, e, f, g, h;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    a = x1 - x0; b = x2 - x1; c = x0; d = y1 - y0; e = y2 - y1; f = y0; g = 0; h = 0;
  } else {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
    a = x1 - x0 + g * x1; b = x3 - x0 + h * x3; c = x0;
    d = y1 - y0 + g * y1; e = y3 - y0 + h * y3; f = y0;
  }
  // maps (u,v,1) → (a u + b v + c, d u + e v + f, g u + h v + 1)
  return [a, d, g, b, e, h, c, f, 1];
}
function invert3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C || 1e-12;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}

export const plane: EffectDef = {
  id: 'plane',
  name: 'Perspective plane',
  category: 'warp',
  description: 'Map the layer onto any four-point quad. Edge "clamp" drags the border pixels out into streaks (ref 01).',
  live: true,
  params: [
    P.quad('quad', [0.18, 0.12, 0.92, 0.26, 0.86, 0.7, 0.1, 0.92], { description: 'Corners tl, tr, br, bl as fractions of the canvas.' }),
    P.rect('source', [0, 0, 1, 1], { description: 'Part of the input mapped onto the plane (x, y, w, h).' }),
    P.enum('edge', 'clamp', ['cut', 'keep', 'clamp', 'repeat', 'mirror'], { description: 'What happens outside the quad.' }),
    P.px('frame', 0, 0, 40, { description: 'A frame along the plane edge (ref 01 barriers).' }),
    P.color('frameColor', '#FF6A1A'),
  ],
  decl: 'uniform mat3 u_hinv;',
  uniforms: (v) => {
    const q = v.quad as number[];
    const quad: V2[] = [[q[0], q[1]], [q[2], q[3]], [q[4], q[5]], [q[6], q[7]]];
    return { u_hinv: invert3(squareToQuad(quad)) };
  },
  glsl: /* glsl */ `
vec4 effect(vec2 p) {
  vec3 r = u_hinv * vec3(p / u_res, 1.0);
  if (r.z <= 0.0) return u_edge == 1 ? src(p) : vec4(0);
  vec2 uv = r.xy / r.z;
  bool inside = all(greaterThanEqual(uv, vec2(0))) && all(lessThanEqual(uv, vec2(1)));
  if (!inside) {
    if (u_edge == 0) return vec4(0);
    if (u_edge == 1) return src(p);
    if (u_edge == 3) uv = fract(uv);
    if (u_edge == 4) uv = 1.0 - abs(mod(uv, 2.0) - 1.0);
    uv = clamp(uv, 0.0, 1.0);
  }
  vec4 c = texture(u_src, u_source.xy + uv * u_source.zw);
  if (u_frame > 0.0 && inside) {
    vec2 fw = fwidth(uv);
    vec2 d = min(uv, 1.0 - uv) / max(fw, vec2(1e-6));
    if (min(d.x, d.y) < u_frame * u_unit) c = vec4(mix(u_frameColor.rgb * 0.55, u_frameColor.rgb, step(0.5, fract(uv.x * 9.0 + uv.y * 3.0))), 1.0);
  }
  return c;
}`,
};

export const stretch: EffectDef = {
  id: 'stretch',
  name: 'Pixel stretch',
  category: 'warp',
  description: 'Take one line of pixels and drag it out into a streak in any direction, with ragged ends (ref 01).',
  live: true,
  params: [
    P.float('at', 0.62, 0, 1, { description: 'Where the source line sits along the direction.' }),
    P.deg('angle', 90, { description: '90 drags downward, 0 to the right.' }),
    P.float('length', 0.5, 0, 1.5, { description: 'Streak length as a fraction of the canvas.' }),
    P.float('spanStart', 0, 0, 1),
    P.float('spanEnd', 1, 0, 1),
    P.float('ragged', 0.5, 0, 1, { description: 'Per-column variation of streak length.' }),
    P.px('jitter', 3, 0, 40, { description: 'Sideways jitter of the sampled line.' }),
    P.px('wobble', 0, 0, 60, { description: 'Sideways sine wobble along the streak.' }),
    P.float('falloff', 0.15, 0, 1, { description: 'Fade the streak toward its end.' }),
    P.px('band', 2, 1, 40, { description: 'Width of each streak column.' }),
  ],
  glsl: /* glsl */ `
vec4 effect(vec2 p) {
  vec2 d = vec2(cos(radians(u_angle)), sin(radians(u_angle)));
  vec2 n = vec2(-d.y, d.x);
  vec2 c = u_res * 0.5;
  float ext = abs(d.x) * u_res.x + abs(d.y) * u_res.y;
  float extN = abs(n.x) * u_res.x + abs(n.y) * u_res.y;
  vec2 origin = c + d * (u_at - 0.5) * ext;
  float t = dot(p - origin, d);
  float u = dot(p - c, n);
  float un = u / extN + 0.5;
  vec4 here = src(p);
  if (t <= 0.0 || un < u_spanStart || un > u_spanEnd) return here;
  int col = int(floor(u / max(1.0, u_band * u_unit)));
  float len = u_length * ext * (1.0 - u_ragged * hash1(col, u_seed));
  if (t > len) return here;
  float j = (hash1(col, u_seed ^ 0x51u) - 0.5) * u_jitter * u_unit;
  float w = sin(t / (80.0 * u_unit) + hash1(col / 8, u_seed) * TAU) * u_wobble * u_unit;
  vec2 q = origin + n * (u + j + w);
  vec4 s = src(q);
  float f = 1.0 - u_falloff * smoothstep(0.0, 1.0, t / max(len, 1.0));
  return mix(here, s, f);
}`,
};
