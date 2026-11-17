import type { GeneratorDef } from '../nodes';
import { solid, gradient, noise, murk } from './glsl-gens';
import { porcelain, signage, uiChrome, roadPaint, hazard, textColumn } from './canvas-gens';

export const GENERATORS: Record<string, GeneratorDef> = Object.fromEntries(
  [noise, murk, porcelain, signage, uiChrome, solid, gradient, roadPaint, hazard, textColumn].map((g) => [g.id, g]),
);

export function registerGenerator(def: GeneratorDef) {
  GENERATORS[def.id] = def;
}
