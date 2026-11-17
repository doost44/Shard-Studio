// GPU generators: solid, gradient, noise, murk. Procedural, seeded, animatable.
import { P } from '../params';
import type { GeneratorDef } from '../nodes';
import { rampFn } from '../nodes';

export const solid: GeneratorDef = {
  id: 'solid',
  name: 'Solid colour',
  description: 'A flat colour.',
  live: true,
  params: [P.color('color', '#F0F0EC')],
  glsl: `vec4 generate(vec2 p) { return u_color; }`,
};

export const gradient: GeneratorDef = {
  id: 'gradient',
  name: 'Gradient',
  description: 'Linear, radial, angular or diamond gradient through a palette ramp, with optional noise.',
  live: true,
  params: [
    P.enum('type', 'linear', ['linear', 'radial', 'angular', 'diamond']),
    P.ramp('ramp', ['#06070C', '#F0F0EC']),
    P.deg('angle', 90),
    P.vec2('center', [0.5, 0.5]),
    P.float('scale', 1, 0.05, 4),
    P.float('noise', 0, 0, 1, { description: 'Noise added to the gradient position.' }),
    P.int('steps', 0, 0, 32, { description: 'Hard bands (0 = smooth).' }),
  ],
  glsl: /* glsl */ `
${rampFn('ramp')}
vec4 generate(vec2 p) {
  vec2 n = p / u_res; vec2 c = u_center; float t;
  vec2 d = vec2(cos(radians(u_angle)), sin(radians(u_angle)));
  vec2 asp = vec2(u_res.x / min(u_res.x, u_res.y), u_res.y / min(u_res.x, u_res.y));
  if (u_type == 0) t = dot(n - 0.5, d) / (abs(d.x) * 1.0 + abs(d.y) * 1.0) + 0.5;
  else if (u_type == 1) t = length((n - c) * asp) * 1.4;
  else if (u_type == 2) t = fract(atan((n - c).y, (n - c).x) / TAU + 0.5 + u_angle / 360.0);
  else t = (abs((n - c).x * asp.x) + abs((n - c).y * asp.y)) * 1.4;
  t = (t - 0.5) / u_scale + 0.5;
  t += fbm(p / (180.0 * u_unit), 4, u_seed) * u_noise * 0.5;
  if (u_steps > 0) t = floor(clamp(t, 0.0, 0.9999) * float(u_steps)) / float(max(1, u_steps - 1));
  return vec4(rampAt(t), 1.0);
}`,
};

export const noise: GeneratorDef = {
  id: 'noise',
  name: 'Noise',
  description: 'Value, Perlin, simplex, Worley, ridged, domain-warped fBm or curl noise, mapped through a ramp.',
  live: true,
  params: [
    P.enum('type', 'warp', ['value', 'perlin', 'simplex', 'worley', 'ridged', 'warp', 'curl']),
    P.px('scale', 260, 4, 2000),
    P.int('octaves', 4, 1, 8),
    P.float('warp', 1.2, 0, 4, { description: 'Domain warp strength (warp type).' }),
    P.float('contrast', 1, 0.1, 4),
    P.float('bias', 0, -1, 1),
    P.ramp('ramp', ['#06070C', '#F0F0EC']),
    P.int('steps', 0, 0, 32, { description: 'Posterize into hard bands (0 = smooth).' }),
    P.float('drift', 0, 0, 2),
    P.float('aspect', 1, 0.1, 10, { description: 'Stretch the noise horizontally.' }),
  ],
  animated: (v) => v.drift > 0,
  glsl: /* glsl */ `
${rampFn('ramp')}
float field(vec2 q, uint s) {
  if (u_type == 0) { float a = 0.5, n = 0.0, t = 0.0; for (int k = 0; k < 8; k++) { if (k >= u_octaves) break; n += a * vnoise(q, s + uint(k)); t += a; q *= 2.03; a *= 0.5; } return n / t; }
  if (u_type == 1) return fbm(q, u_octaves, s) * 0.5 + 0.5;
  if (u_type == 2) { float a = 0.5, n = 0.0, t = 0.0; for (int k = 0; k < 8; k++) { if (k >= u_octaves) break; n += a * snoise(q, s + uint(k)); t += a; q = rot2(0.5) * q * 2.03; a *= 0.5; } return n / t * 0.5 + 0.5; }
  if (u_type == 3) { vec3 w = worley(q, s); return clamp(w.y - w.x, 0.0, 1.0); }
  if (u_type == 4) return ridged(q, u_octaves, s);
  if (u_type == 5) { vec2 w = vec2(fbm(q, 3, s ^ 1u), fbm(q + 5.2, 3, s ^ 2u)); vec2 w2 = vec2(fbm(q + w * u_warp, 3, s ^ 3u), fbm(q + w * u_warp + 1.7, 3, s ^ 4u)); return fbm(q + w2 * u_warp, u_octaves, s) * 0.5 + 0.5; }
  float e = 0.01; float a = fbm(q + vec2(0, e), u_octaves, s), b = fbm(q - vec2(0, e), u_octaves, s), c = fbm(q + vec2(e, 0), u_octaves, s), d = fbm(q - vec2(e, 0), u_octaves, s);
  vec2 curl = vec2(a - b, -(c - d)) / (2.0 * e);
  return atan(curl.y, curl.x) / TAU + 0.5;
}
vec4 generate(vec2 p) {
  vec2 q = p / (u_scale * u_unit); q.x /= u_aspect;
  q += vec2(u_time * u_drift * 0.4, u_time * u_drift * 0.23);
  float n = field(q, u_seed);
  n = (n - 0.5) * u_contrast + 0.5 + u_bias * 0.5;
  if (u_steps > 0) n = floor(clamp(n, 0.0, 0.9999) * float(u_steps)) / float(max(1, u_steps - 1));
  return vec4(rampAt(n), 1.0);
}`,
};

export const murk: GeneratorDef = {
  id: 'murk',
  name: 'Murk ground',
  description: 'Grey ground with near-black, melted blotches and light rims (ref 02).',
  live: true,
  params: [
    P.color('base', '#5E6266'),
    P.color('dark', '#16181B'),
    P.color('light', '#9BA0A6'),
    P.px('scale', 300, 20, 2000),
    P.float('coverage', 0.35, 0, 1),
    P.float('sharpness', 0.8, 0, 1),
    P.float('warp', 1.4, 0, 4),
    P.float('mottle', 0.5, 0, 1, { description: 'Lighter and darker patches in the grey.' }),
    P.float('specks', 0.4, 0, 1),
    P.float('grain', 0.25, 0, 1),
    P.float('drift', 0, 0, 1),
  ],
  animated: (v) => v.drift > 0,
  glsl: /* glsl */ `
vec4 generate(vec2 p) {
  vec2 q = p / (u_scale * u_unit) + u_time * u_drift * vec2(0.05, 0.03);
  vec2 w = vec2(fbm(q * 0.8, 3, u_seed), fbm(q * 0.8 + 5.2, 3, u_seed + 1u)) * u_warp;
  float n = fbm(q + w, 5, u_seed + 2u) * 0.5 + 0.5;
  float th = mix(0.78, 0.38, u_coverage);
  float soft = mix(0.12, 0.006, u_sharpness);
  float blot = smoothstep(th, th + soft, n);
  float m = fbm(q * 2.1 + w * 0.5, 4, u_seed + 3u);
  vec3 base = mix(u_base.rgb, m > 0.0 ? u_light.rgb : u_dark.rgb, abs(m) * u_mottle * 0.8);
  // light halo just outside each blotch, like water stains
  float rim = smoothstep(th - 0.06, th - 0.01, n) * (1.0 - blot);
  base = mix(base, u_light.rgb, rim * 0.35);
  // ripples inside the grey
  float rip = sin((fbm(q * 3.0 + w, 3, u_seed + 4u)) * 40.0);
  base *= 1.0 + rip * 0.025 * u_mottle;
  vec3 c = mix(base, u_dark.rgb, blot);
  // small dark specks
  vec3 wv = worley(p / (26.0 * u_unit), u_seed + 5u);
  float sp = step(wv.z, u_specks * 0.08) * smoothstep(0.32, 0.18, wv.x);
  c = mix(c, u_dark.rgb, sp);
  c += (hashf(ivec2(p), u_seed + 6u) - 0.5) * u_grain * 0.12;
  return vec4(c, 1.0);
}`,
};
