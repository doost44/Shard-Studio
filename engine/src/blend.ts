// Layer compositing and effect mixing, with the full Photoshop blend set plus
// glitch modes. Straight (non-premultiplied) alpha throughout.

import { PRELUDE } from './gl/glsl-lib';
import { BLEND_MODES, type BlendMode } from './doc';

export const blendIndex = (m: BlendMode | undefined) => Math.max(0, BLEND_MODES.indexOf(m ?? 'normal'));

export const COMPOSITE_FRAG = /* glsl */ `${PRELUDE}
uniform sampler2D u_dst;   // backdrop (what is below / the effect's input)
uniform sampler2D u_src;   // layer content / the effect's output
uniform sampler2D u_mask;
uniform bool u_hasMask;
uniform float u_opacity;
uniform int u_mode;
uniform int u_op;          // 0 = source-over (layers), 1 = mix (effects)

float sat3(vec3 c) { return max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b)); }
vec3 clipColor(vec3 c) { float l = lum(c), n = min(c.r, min(c.g, c.b)), x = max(c.r, max(c.g, c.b));
  if (n < 0.0) c = l + (c - l) * l / max(l - n, 1e-5); if (x > 1.0) c = l + (c - l) * (1.0 - l) / max(x - l, 1e-5); return c; }
vec3 setLum(vec3 c, float l) { return clipColor(c + (l - lum(c))); }
vec3 setSat(vec3 c, float s) { float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  return mx > mn ? (c - mn) * s / (mx - mn) : vec3(0); }
float softL(float b, float s) { float d = b <= 0.25 ? ((16.0 * b - 12.0) * b + 4.0) * b : sqrt(b);
  return s <= 0.5 ? b - (1.0 - 2.0 * s) * b * (1.0 - b) : b + (2.0 * s - 1.0) * (d - b); }
float burn(float b, float s) { return b >= 1.0 ? 1.0 : s <= 0.0 ? 0.0 : 1.0 - min(1.0, (1.0 - b) / s); }
float dodge(float b, float s) { return b <= 0.0 ? 0.0 : s >= 1.0 ? 1.0 : min(1.0, b / (1.0 - s)); }
float hardL(float b, float s) { return s <= 0.5 ? b * 2.0 * s : 1.0 - (1.0 - b) * (1.0 - (2.0 * s - 1.0)); }
float vivid(float b, float s) { return s <= 0.5 ? burn(b, 2.0 * s) : dodge(b, 2.0 * s - 1.0); }
float pinL(float b, float s) { return s <= 0.5 ? min(b, 2.0 * s) : max(b, 2.0 * s - 1.0); }

vec3 blendRGB(vec3 b, vec3 s, vec2 p, out float alphaGate) {
  alphaGate = 1.0;
  switch (u_mode) {
    case 0: case 1: return s;
    case 2: return min(b, s);
    case 3: return b * s;
    case 4: return vec3(burn(b.r, s.r), burn(b.g, s.g), burn(b.b, s.b));
    case 5: return max(b + s - 1.0, 0.0);
    case 6: return lum(s) < lum(b) ? s : b;
    case 7: return max(b, s);
    case 8: return b + s - b * s;
    case 9: return vec3(dodge(b.r, s.r), dodge(b.g, s.g), dodge(b.b, s.b));
    case 10: return min(b + s, 1.0);
    case 11: return lum(s) > lum(b) ? s : b;
    case 12: return vec3(hardL(s.r, b.r), hardL(s.g, b.g), hardL(s.b, b.b));
    case 13: return vec3(softL(b.r, s.r), softL(b.g, s.g), softL(b.b, s.b));
    case 14: return vec3(hardL(b.r, s.r), hardL(b.g, s.g), hardL(b.b, s.b));
    case 15: return vec3(vivid(b.r, s.r), vivid(b.g, s.g), vivid(b.b, s.b));
    case 16: return clamp(b + 2.0 * s - 1.0, 0.0, 1.0);
    case 17: return vec3(pinL(b.r, s.r), pinL(b.g, s.g), pinL(b.b, s.b));
    case 18: return step(1.0, b + s);
    case 19: return abs(b - s);
    case 20: return b + s - 2.0 * b * s;
    case 21: return max(b - s, 0.0);
    case 22: return clamp(b / max(s, 1e-4), 0.0, 1.0);
    case 23: return setLum(setSat(s, sat3(b)), lum(b));
    case 24: return setLum(setSat(b, sat3(s)), lum(b));
    case 25: return setLum(s, lum(b));
    case 26: return setLum(b, lum(s));
    case 27: return vec3(s.b, b.g, s.r);                       // channel swap
    case 28: { uvec3 x = uvec3(b * 255.0 + 0.5) ^ uvec3(s * 255.0 + 0.5); return vec3(x) / 255.0; } // xor
    case 29: { bool d = length(b - s) > 0.25; alphaGate = d ? 1.0 : 0.0; return s; } // difference-mosh
    case 30: { vec2 off = (lum(s) - 0.5) * vec2(60.0, 24.0) * u_unit; return texture(u_dst, (p + off) / u_res).rgb; } // luma displace
    case 31: { vec2 off = vec2((lum(s) - 0.5) * 30.0 * u_unit, 0.0); return vec3(texture(u_dst, (p + off) / u_res).r, b.g, texture(u_dst, (p - off) / u_res).b); }
  }
  return s;
}

void main() {
  vec2 p = gl_FragCoord.xy;
  vec4 B = texture(u_dst, p / u_res);
  vec4 S = texture(u_src, p / u_res);
  float m = u_opacity;
  if (u_hasMask) m *= texture(u_mask, p / u_res).r;
  float gate;
  vec3 mixed = blendRGB(B.rgb, S.rgb, p, gate);
  if (u_mode == 1) gate = step(hashf(ivec2(p), u_seed), S.a * m) / max(S.a * m, 1e-4); // dissolve
  if (u_op == 1) {
    // effect mix: amount × mask blends the (blended) effect output over its input
    vec4 E = vec4(u_mode == 0 ? S.rgb : mix(S.rgb, mixed, B.a), S.a);
    o_color = mix(B, E, clamp(m * gate, 0.0, 1.0));
    return;
  }
  float as = S.a * m * gate;
  float ab = B.a;
  float ao = as + ab * (1.0 - as);
  vec3 cs = mix(S.rgb, mixed, ab);           // where there is no backdrop, the source shows as itself
  vec3 co = (cs * as + B.rgb * ab * (1.0 - as)) / max(ao, 1e-5);
  o_color = vec4(co, ao);
}
`;
