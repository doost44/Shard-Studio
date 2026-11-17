// Small shared helpers: seeded randomness, stable hashing, colour parsing.
// Everything random in the engine goes through a seed so a document renders
// the same pixels on every machine.

/** xorshift32, returns floats in [0,1). Same sequence as distort.js's rng(). */
export function rng(seed = 1): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return (s % 1e9) / 1e9;
  };
}

/** Mix two integers into a new seed (for per-layer / per-effect seeds). */
export function mixSeed(a: number, b: number): number {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (b >>> 0), 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0 || 1;
}

/** Stable hash of any JSON-like value (key order independent). */
export function hashValue(v: unknown): string {
  return fnv(stableStringify(v));
}
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'u';
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => JSON.stringify(k) + ':' + stableStringify(o[k])).join(',') + '}';
}
export function fnv(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

export type RGB = [number, number, number];
export type RGBA = [number, number, number, number];

/** '#RRGGBB' or '#RRGGBBAA' or [r,g,b(,a)] (0..1) → RGBA 0..1. */
export function parseColor(c: unknown, fallback: RGBA = [0, 0, 0, 1]): RGBA {
  if (Array.isArray(c)) return [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, c[3] ?? 1];
  if (typeof c !== 'string' || c[0] !== '#') return fallback;
  const h = c.length === 4 ? c.slice(1).split('').map((x) => x + x).join('') : c.slice(1);
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return [n(0), n(2), n(4), h.length >= 8 ? n(6) : 1];
}
export function toCss(c: unknown, alpha = 1): string {
  const [r, g, b, a] = parseColor(c);
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a * alpha})`;
}

export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
