// Shared GLSL ES 3.00 prelude for every effect, generator, mask and blend.
//
// Conventions:
//  * `p` is a pixel coordinate with y pointing DOWN (row 0 = top of the image).
//    Textures store row 0 at the top as well, so no flips happen anywhere
//    except the final blit to the screen.
//  * u_unit = min(width, height) / 1080: pixel-sized parameters are authored
//    for a 1080-wide canvas and scale with the document, so a thumbnail or a
//    720×480 HUD render looks like the full-size one.
//  * Randomness uses integer hashing (PCG), which is exact on every GPU.

export const PRELUDE = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform vec2 u_res;
uniform float u_unit;
uniform float u_time;
uniform uint u_seed;
out vec4 o_color;

#define PI 3.14159265359
#define TAU 6.28318530718

uint pcg(uint v) { uint s = v * 747796405u + 2891336453u; uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
uint hash3u(uvec3 v) { return pcg(v.x ^ pcg(v.y ^ pcg(v.z))); }
float hashf(ivec2 p, uint s) { return float(hash3u(uvec3(uvec2(p), s))) / 4294967295.0; }
float hash1(int i, uint s) { return float(pcg(uint(i) ^ pcg(s))) / 4294967295.0; }
vec2 hash2(ivec2 p, uint s) { return vec2(hashf(p, s), hashf(p, s ^ 0x9e3779b9u)); }

float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

// value noise, 0..1
float vnoise(vec2 x, uint s) {
  ivec2 i = ivec2(floor(x)); vec2 f = fract(x); vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hashf(i, s), b = hashf(i + ivec2(1, 0), s), c = hashf(i + ivec2(0, 1), s), d = hashf(i + ivec2(1, 1), s);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// gradient (Perlin) noise, about -1..1
vec2 grad2(ivec2 i, uint s) { float a = hashf(i, s) * TAU; return vec2(cos(a), sin(a)); }
float gnoise(vec2 x, uint s) {
  ivec2 i = ivec2(floor(x)); vec2 f = fract(x); vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(grad2(i, s), f), b = dot(grad2(i + ivec2(1, 0), s), f - vec2(1, 0));
  float c = dot(grad2(i + ivec2(0, 1), s), f - vec2(0, 1)), d = dot(grad2(i + ivec2(1, 1), s), f - vec2(1, 1));
  return 1.41 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// simplex noise, about -1..1
float snoise(vec2 v, uint s) {
  const float F2 = 0.366025403784, G2 = 0.211324865405;
  vec2 i = floor(v + dot(v, vec2(F2))); vec2 x0 = v - i + dot(i, vec2(G2));
  vec2 i1 = x0.x > x0.y ? vec2(1, 0) : vec2(0, 1);
  vec2 x1 = x0 - i1 + G2, x2 = x0 - 1.0 + 2.0 * G2;
  ivec2 ii = ivec2(i);
  float n = 0.0, t;
  t = 0.5 - dot(x0, x0); if (t > 0.0) { t *= t; n += t * t * dot(grad2(ii, s), x0); }
  t = 0.5 - dot(x1, x1); if (t > 0.0) { t *= t; n += t * t * dot(grad2(ii + ivec2(i1), s), x1); }
  t = 0.5 - dot(x2, x2); if (t > 0.0) { t *= t; n += t * t * dot(grad2(ii + ivec2(1, 1), s), x2); }
  return 70.0 * n;
}
// cellular: x = F1, y = F2 distance, z = cell id hash
vec3 worley(vec2 x, uint s) {
  ivec2 i = ivec2(floor(x)); vec2 f = fract(x); float d1 = 8.0, d2 = 8.0; float id = 0.0;
  for (int y = -1; y <= 1; y++) for (int xx = -1; xx <= 1; xx++) {
    ivec2 g = ivec2(xx, y); vec2 r = vec2(g) + hash2(i + g, s) - f; float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = hashf(i + g, s ^ 77u); } else if (d < d2) d2 = d;
  }
  return vec3(sqrt(d1), sqrt(d2), id);
}
float fbm(vec2 x, int oct, uint s) {
  float a = 0.5, t = 0.0, n = 0.0;
  for (int k = 0; k < 8; k++) { if (k >= oct) break; n += a * gnoise(x, s + uint(k) * 1013u); t += a; x = rot2(0.6) * x * 2.03 + 17.1; a *= 0.5; }
  return n / t;
}
float ridged(vec2 x, int oct, uint s) {
  float a = 0.5, t = 0.0, n = 0.0;
  for (int k = 0; k < 8; k++) { if (k >= oct) break; n += a * (1.0 - abs(gnoise(x, s + uint(k) * 1013u))); t += a; x = rot2(0.6) * x * 2.03 + 17.1; a *= 0.5; }
  return n / t;
}
`;

/** Prelude for effects: one input image, sampled in pixel coordinates. */
export const EFFECT_PRELUDE = /* glsl */ `
uniform sampler2D u_src;
vec4 src(vec2 p) { return texture(u_src, p / u_res); }
vec4 srcPx(ivec2 p) { return texelFetch(u_src, clamp(p, ivec2(0), ivec2(u_res) - 1), 0); }
`;

export const VERTEX = /* glsl */ `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

/** Shader that blits to the screen, flipping y (screen row 0 is the bottom). */
export const BLIT_FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D u_src; uniform vec2 u_res; uniform int u_checker;
out vec4 o_color;
void main() {
  vec2 uv = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y) / u_res;
  vec4 c = texture(u_src, uv);
  if (u_checker == 1) {
    vec2 q = floor(gl_FragCoord.xy / 12.0); float k = mod(q.x + q.y, 2.0) * 0.08 + 0.18;
    c.rgb = mix(vec3(k), c.rgb, c.a); c.a = 1.0;
  }
  o_color = c;
}
`;
