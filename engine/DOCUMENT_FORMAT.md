# Shard document format (version 1)

A document is JSON. It is a non-destructive layer tree: layers produce pixels
(generators, inputs, images), each layer has an ordered **effect stack**, and
**masks** place every layer and effect. Pixels are computed, never stored,
except image assets.

```jsonc
{
  "format": "shard-document",
  "version": 1,
  "name": "Porcelain glitch",
  "width": 1080, "height": 1920,
  "seed": 202,                                  // every random choice derives from this
  "background": { "type": "color", "color": "#5E6266" },   // or { "type": "transparent" }
  "inputs": { "main": { "kind": "live", "label": "Face" } }, // a slot, never frames
  "signals": { "progress": 1 },                  // preview values for driven params
  "assets": { "img1": { "type": "image", "src": "data:image/png;base64,…" } },
  "layers": [ /* bottom → top */ ]
}
```

## Layers

Common fields: `id` (unique), `name`, `visible`, `opacity` (drivable), `blend`,
`effects`, `mask`, `seed` (overrides the derived seed; survives "reseed all").

| type | fields | what it is |
| --- | --- | --- |
| `generator` | `generator`, `params` | procedural content (see below) |
| `source` | `input`, `fit`, `mirror` | a named input: webcam, video, test image |
| `raster` | `asset`, `fit` | an image asset |
| `effect` | — | applies its stack to everything below, mixed back by mask × opacity |
| `group` | `layers`, `passThrough` | isolated (default) or pass-through group |

`fit`: `cover` (default), `contain`, `stretch`, `none`.

## Effects

```jsonc
{ "id": "melt", "effect": "liquify", "params": { "amount": 90 },
  "amount": 1, "blend": "normal", "mask": { … }, "enabled": true, "seed": 7 }
```

Phase 1 effects: `liquify`, `glaze`, `contours`, `slices`, `stretch`, `plane`,
`mosh`, `jpeg`, `rgbSplit`, `crt`. Every parameter, its range and default, is
declared in `engine/src/effects/*.ts`. Pixel sizes are authored for a 1080-wide
canvas and scale with the document (`unit = min(w, h) / 1080`).

## Generators

`noise`, `murk`, `porcelain`, `signage`, `uiChrome`, plus `solid`, `gradient`,
`roadPaint`, `hazard`, `textColumn`. Parameters in `engine/src/generators/*.ts`.

## Driven parameters

Any parameter (and a layer's `opacity`, an effect's `amount`) can be a literal or:

```jsonc
{ "ramp": [20, 110], "curve": "ease", "signal": "progress" }   // first reel → full face
{ "lfo": { "wave": "sine", "freq": 0.25, "min": 0, "max": 1 } }
{ "signal": "desire", "min": 0, "max": 200 }
```

`curve`: `linear`, `ease`, `in`, `out`, `hold`, or a number (gamma). Colours ramp too.

## Masks

Coordinates are fractions of the canvas; `torn` and `feather` are px at 1080 scale.

```jsonc
{ "shape": "ellipse", "cx": 0.5, "cy": 0.4, "rx": 0.3, "ry": 0.2, "angle": 0, "torn": 24, "feather": 0, "invert": false }
{ "shape": "rect", "x": 0.1, "y": 0.6, "w": 0.8, "h": 0.4, "angle": 0 }
{ "shape": "poly", "points": [x0, y0, x1, y1, …] }
{ "shape": "noise", "scale": 160, "threshold": 0.58, "softness": 0.02, "type": "perlin" }   // perlin | worley | value
{ "shape": "luma", "lo": 0.5, "hi": 1.01, "softness": 0.04 }                              // from the layer's own content
{ "shape": "bands", "count": 12, "angle": 0, "duty": 0.5, "jitter": 0.3 }
{ "shape": "combine", "op": "add", "masks": [ … ] }                                          // add | subtract | intersect
```

## Blend modes

The Photoshop set (`normal`, `dissolve`, `darken`, `multiply`, `color-burn`,
`linear-burn`, `darker-color`, `lighten`, `screen`, `color-dodge`,
`linear-dodge`, `lighter-color`, `overlay`, `soft-light`, `hard-light`,
`vivid-light`, `linear-light`, `pin-light`, `hard-mix`, `difference`,
`exclusion`, `subtract`, `divide`, `hue`, `saturation`, `color`, `luminosity`)
plus glitch modes `channel-swap`, `xor`, `difference-mosh`, `luma-displace`,
`channel-offset`.

## Seeds and determinism

Layer seed = `layer.seed` or a hash of (document seed, layer id); effect seed =
`effect.seed` or a hash of (layer seed, position). GPU randomness uses integer
hashing, so the same document, seeds and inputs render the same pixels on any
machine, within float tolerance (Canvas 2D text can differ by a pixel between
font rasterisers).

## Versioning

`validateDocument` migrates older versions step by step and lists every problem
it finds in one error, so a bad file fails with a clear message.
