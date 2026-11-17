// Definitions shared by effects and generators: typed parameters that become
// GLSL uniforms automatically, plus an optional multi-pass or canvas path.

import type { ParamDef } from './params';
import type { GPU, Target, UniformValue } from './gl/gpu';
import { parseColor } from './util';
import { PRELUDE, EFFECT_PRELUDE } from './gl/glsl-lib';

export interface NodeInfo {
  w: number;
  h: number;
  seed: number;
  unit: number;
  time: number;
}

export interface EffectRenderContext extends NodeInfo {
  gpu: GPU;
  input: Target;
  values: Record<string, any>;
  /** Run this effect's own GLSL (if any) with extra uniforms. */
  shader(key: string, glsl: string, uniforms: Record<string, UniformValue>, into?: Target): Target;
}

export type Category = 'warp' | 'damage' | 'colour' | 'line' | 'texture' | 'collage' | 'screen';

export interface EffectDef {
  id: string;
  name: string;
  category: Category;
  description: string;
  params: ParamDef[];
  /** Fast enough for the live 30 fps budget on the GPU. */
  live: boolean;
  /** GLSL that defines `vec4 effect(vec2 p)`. Params are uniforms named u_<param>. */
  glsl?: string;
  /** Extra GLSL declarations (derived uniforms). */
  decl?: string;
  /** Derived uniforms computed on the CPU (band tables, matrices…). */
  uniforms?: (values: Record<string, any>, info: NodeInfo) => Record<string, UniformValue>;
  /** True if output changes with time for these values (drift, roll…). */
  animated?: (values: Record<string, any>) => boolean;
  /** Custom multi-pass render. Returns a target the caller owns. */
  render?: (rc: EffectRenderContext) => Target;
}

export interface GeneratorDef {
  id: string;
  name: string;
  description: string;
  params: ParamDef[];
  live: boolean;
  glsl?: string; // defines vec4 generate(vec2 p)
  decl?: string;
  uniforms?: (values: Record<string, any>, info: NodeInfo) => Record<string, UniformValue>;
  animated?: (values: Record<string, any>) => boolean;
  /** Canvas 2D generator (shapes and type). Draw into ctx at w×h. */
  draw?: (ctx: OffscreenCanvasRenderingContext2D, info: NodeInfo, values: Record<string, any>) => void;
}

/** GLSL uniform declarations for a list of params. */
export function paramDecls(params: ParamDef[]): string {
  const out: string[] = [];
  for (const p of params) {
    if (p.uniform === false) continue;
    const n = 'u_' + p.name;
    switch (p.kind) {
      case 'float': out.push(`uniform float ${n};`); break;
      case 'int': out.push(`uniform int ${n};`); break;
      case 'bool': out.push(`uniform bool ${n};`); break;
      case 'enum': out.push(`uniform int ${n};`); break;
      case 'color': out.push(`uniform vec4 ${n};`); break;
      case 'vec2': out.push(`uniform vec2 ${n};`); break;
      case 'rect': out.push(`uniform vec4 ${n};`); break;
      case 'ramp': out.push(`uniform vec3 ${n}[${p.maxStops ?? 8}];`, `uniform int ${n}N;`); break;
      default: break;
    }
  }
  return out.join('\n');
}

/** Resolved values → uniform values. */
export function paramUniforms(params: ParamDef[], values: Record<string, any>): Record<string, UniformValue> {
  const u: Record<string, UniformValue> = {};
  for (const p of params) {
    if (p.uniform === false) continue;
    const v = values[p.name];
    const n = 'u_' + p.name;
    switch (p.kind) {
      case 'float': u[n] = Number(v); break;
      case 'int': u[n] = Math.round(Number(v)); break;
      case 'bool': u[n] = v ? 1 : 0; break;
      case 'enum': u[n] = Math.max(0, (p.options ?? []).indexOf(String(v))); break;
      case 'color': u[n] = parseColor(v); break;
      case 'vec2': case 'rect': u[n] = v as number[]; break;
      case 'ramp': {
        const cols = (Array.isArray(v) ? v : [v]).slice(0, p.maxStops ?? 8).map((c: unknown) => parseColor(c).slice(0, 3));
        u[n] = cols.flat();
        u[n + 'N'] = cols.length;
        break;
      }
      default: break;
    }
  }
  return u;
}

/** GLSL helper for sampling a ramp uniform at t in 0..1. */
export function rampFn(name: string): string {
  return `vec3 ${name}At(float t) { int n = u_${name}N; if (n <= 1) return u_${name}[0];
  float x = clamp(t, 0.0, 1.0) * float(n - 1); int a = int(floor(x)); int b = min(n - 1, a + 1);
  return mix(u_${name}[a], u_${name}[b], x - float(a)); }`;
}
export function rampStepFn(name: string): string {
  return `vec3 ${name}Step(float t) { int n = u_${name}N; int a = clamp(int(floor(clamp(t, 0.0, 0.9999) * float(n))), 0, n - 1); return u_${name}[a]; }`;
}

export function effectSource(def: { params: ParamDef[]; decl?: string; glsl?: string }): string {
  return `${PRELUDE}${EFFECT_PRELUDE}
${paramDecls(def.params)}
${def.decl ?? ''}
${def.glsl}
void main() { o_color = effect(gl_FragCoord.xy); }
`;
}

export function generatorSource(def: { params: ParamDef[]; decl?: string; glsl?: string }): string {
  return `${PRELUDE}
${paramDecls(def.params)}
${def.decl ?? ''}
${def.glsl}
void main() { o_color = generate(gl_FragCoord.xy); }
`;
}
