// Colour, line and screen effects: glaze, contours, CRT.
import { P } from '../params';
import type { EffectDef } from '../nodes';
import { rampFn, rampStepFn } from '../nodes';
import { GLAZE_RAMP } from '../palette';

export const glaze: EffectDef = {
  id: 'glaze',
  name: 'Glaze',
  category: 'colour',
  description: 'Posterize luminance onto a palette ramp (ink → cobalt → porcelain): blue-and-white china, with brushy band edges.',
  live: true,
  params: [
    P.int('levels', 5, 2, 16),
    P.ramp('ramp', [...GLAZE_RAMP]),
    P.float('contrast', 1.2, 0.2, 3),
    P.float('shift', 0, -1, 1, { description: 'Slide luminance up or down the ramp.' }),
    P.float('wobble', 0.35, 0, 1, { description: 'Brushy, uneven band edges.' }),
    P.px('wobbleScale', 60, 4, 400),
    P.bool('smooth', false, { description: 'Blend between ramp colours instead of hard steps.' }),
    P.float('keep', 0, 0, 1, { description: 'Blend back the original colour.' }),
  ],
  decl: '',
  glsl: /* glsl */ `
${rampFn('ramp')}
${rampStepFn('ramp')}
vec4 effect(vec2 p) {
  vec4 c = src(p);
  float l = (lum(c.rgb) - 0.5) * u_contrast + 0.5 + u_shift;
  l += (fbm(p / (u_wobbleScale * u_unit), 3, u_seed) * 0.5 + (vnoise(p / (3.0 * u_unit), u_seed ^ 7u) - 0.5) * 0.15) * u_wobble * 0.35;
  float q = floor(clamp(l, 0.0, 0.9999) * float(u_levels)) / float(u_levels - 1);
  vec3 g = u_smooth ? rampAt(q) : rampStep(clamp(q, 0.0, 1.0));
  return vec4(mix(g, c.rgb, u_keep), c.a);
}`,
};

export const contours: EffectDef = {
  id: 'contours',
  name: 'Contours',
  category: 'line',
  description: 'White isolines where posterized luminance changes, with a dark shadow line (the traced damage of ref 02).',
  live: true,
  params: [
    P.int('levels', 6, 2, 24),
    P.px('width', 2, 1, 10),
    P.color('color', '#F0F0EC'),
    P.color('shadow', '#06070C'),
    P.px('shadowOffset', 2, 0, 12),
    P.px('smoothing', 2, 0, 12, { description: 'Blur luminance first for cleaner, rounder lines.' }),
    P.float('wobble', 0.2, 0, 1),
    P.bool('linesOnly', false, { description: 'Output only the lines on transparent.' }),
  ],
  glsl: /* glsl */ `
float lq(vec2 p) {
  float r = max(0.5, u_smoothing * u_unit);
  float l = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) l += lum(src(p + vec2(x, y) * r).rgb);
  l /= 9.0;
  l += (vnoise(p / (40.0 * u_unit), u_seed) - 0.5) * u_wobble * 0.12;
  return floor(clamp(l, 0.0, 0.9999) * float(u_levels));
}
bool edgeAt(vec2 p) {
  float w = u_width * u_unit;
  float a = lq(p);
  return a != lq(p + vec2(w, 0)) || a != lq(p + vec2(0, w));
}
vec4 effect(vec2 p) {
  vec4 c = u_linesOnly ? vec4(0) : src(p);
  vec2 so = vec2(u_shadowOffset * u_unit);
  if (u_shadowOffset > 0.0 && edgeAt(p - so)) c = vec4(u_shadow.rgb, 1.0);
  if (edgeAt(p)) c = vec4(u_color.rgb, 1.0);
  return c;
}`,
};

export const crt: EffectDef = {
  id: 'crt',
  name: 'CRT',
  category: 'screen',
  description: 'Scanlines, aperture grille, barrel curve, bloom, a rolling bar, flicker and vignette.',
  live: true,
  params: [
    P.float('scan', 0.3, 0, 1),
    P.px('linePeriod', 3, 2, 12),
    P.float('grille', 0.15, 0, 1),
    P.float('curve', 0.06, 0, 0.4),
    P.float('bloom', 0.35, 0, 1.5),
    P.px('bloomRadius', 8, 1, 40),
    P.float('roll', 0.5, 0, 1),
    P.float('rollSpeed', 0.15, 0, 2),
    P.float('flicker', 0.04, 0, 0.5),
    P.float('vignette', 0.45, 0, 1),
  ],
  animated: (v) => (v.roll > 0 && v.rollSpeed > 0) || v.flicker > 0,
  glsl: /* glsl */ `
vec4 effect(vec2 p) {
  vec2 n = p / u_res * 2.0 - 1.0;
  float r2 = dot(n, n);
  vec2 q = (n * (1.0 + u_curve * r2) + 1.0) * 0.5 * u_res;
  if (q.x < 0.0 || q.y < 0.0 || q.x > u_res.x || q.y > u_res.y) return vec4(0, 0, 0, 1);
  vec4 c = src(q);
  if (u_bloom > 0.0) {
    vec3 b = vec3(0); float R = u_bloomRadius * u_unit;
    for (int i = 0; i < 12; i++) {
      float a = float(i) * TAU / 12.0;
      vec3 s1 = src(q + vec2(cos(a), sin(a)) * R).rgb, s2 = src(q + vec2(cos(a + 0.26), sin(a + 0.26)) * R * 2.2).rgb;
      b += max(s1 - 0.55, 0.0) + max(s2 - 0.55, 0.0) * 0.6;
    }
    c.rgb += b / 12.0 * u_bloom * 2.0;
  }
  float per = max(2.0, u_linePeriod * u_unit);
  float line = step(per * 0.5, mod(q.y, per));
  c.rgb *= 1.0 - u_scan * (1.0 - line);
  int g = int(mod(floor(q.x / max(1.0, u_unit)), 3.0));
  vec3 gm = g == 0 ? vec3(1, 0.7, 0.7) : g == 1 ? vec3(0.7, 1, 0.7) : vec3(0.7, 0.7, 1);
  c.rgb *= mix(vec3(1), gm, u_grille);
  float ry = fract(u_time * u_rollSpeed) * 1.4 - 0.2;
  float bar = exp(-pow((q.y / u_res.y - ry) * 9.0, 2.0));
  c.rgb += bar * 0.08 * u_roll;
  c.rgb *= 1.0 - u_flicker * hash1(int(u_time * 30.0), u_seed);
  c.rgb *= 1.0 - u_vignette * smoothstep(0.35, 1.4, r2);
  return vec4(c.rgb, 1.0);
}`,
};
