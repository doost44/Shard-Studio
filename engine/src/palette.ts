// The Reel Life palette ships built in. Palettes are document assets; this is
// the default set every new document starts with.

export const REEL_PALETTE = {
  cobalt: '#1B2FD6',
  cobaltDeep: '#0A126E',
  ink: '#06070C',
  porcelain: '#F0F0EC',
  bone: '#D8D1BA',
  safety: '#FF6A1A',
  cable: '#6E727A',
  murk: '#5E6266',
  frameRed: '#E0402A',
  wash: '#6F86F0',
} as const;

/** ink → deep cobalt → cobalt → wash → porcelain: the glaze ramp of ref 02. */
export const GLAZE_RAMP = [REEL_PALETTE.ink, REEL_PALETTE.cobaltDeep, REEL_PALETTE.cobalt, REEL_PALETTE.wash, REEL_PALETTE.porcelain];
export const THERMAL_RAMP = ['#06070C', '#2A0B5E', '#9C1F6E', '#FF6A1A', '#FFE36B', '#FFFFFF'];
