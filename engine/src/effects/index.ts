import type { EffectDef } from '../nodes';
import { liquify, plane, stretch } from './warp';
import { slices, mosh, jpeg, rgbSplit } from './damage';
import { glaze, contours, crt } from './look';

/** Phase 1: the ten techniques ported from a3-look-toolkit/distort.js as GPU shaders. */
export const EFFECTS: Record<string, EffectDef> = Object.fromEntries(
  [liquify, glaze, contours, slices, stretch, plane, mosh, jpeg, rgbSplit, crt].map((e) => [e.id, e]),
);

export function registerEffect(def: EffectDef) {
  EFFECTS[def.id] = def;
}
