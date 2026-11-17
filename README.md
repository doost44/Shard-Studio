# Shard Studio

A procedural distortion image editor, and the look engine for **The Reel Life**.
Everything is code: no stock images and no image-generation models. A look comes
from the engine, so it reads the same on a blank canvas, a grey photo, a webcam
frame or a face.

Status: **Phase 1, engine core.** The editor UI (`studio/`) and the exhibit player
(`runtime/`) come in later phases; see the build order in the brief.

```
engine/      document model, effect graph, effects, generators, renderer (no UI code)
  src/       TypeScript sources
  public/    bundled fonts and sample documents
  test/      golden-image harness, fixtures, benchmarks
  index.html a minimal page that renders a document from JSON
docs/        preset proof renders, phase reports
studio/      (Phase 2) the editor
runtime/     (Phase 8) the small player The Reel Life embeds
```

## Run it

```sh
npm install
npm run dev          # open http://localhost:5199/ : pick a document, an input, drag "progress"
npm test             # golden-image tests in headless Chromium
npm run test:update  # accept new renders as goldens
npm run proof        # full-size renders of every sample on blank / grey / gradient / face → docs/preset-proof/
npm run bench        # frame times at 1080×1920 and 720×480
npm run typecheck
```

Everything runs offline. There are no network calls in the engine.

## Using the engine

```ts
import { ShardEngine } from './engine/src';

const engine = await ShardEngine.create(canvas, { fontBase: './fonts/' });
await engine.load(documentJson);          // validated; clear errors if it is malformed
engine.setInput('main', videoOrImage);    // frames are never stored in the document
engine.setSignal('progress', 0.42);       // drives every { ramp: [firstReel, fullFace] } parameter
engine.render(timeSeconds);               // cached: only changed nodes re-render
engine.present();                         // draw to the canvas
```

The document format is described in [`engine/DOCUMENT_FORMAT.md`](engine/DOCUMENT_FORMAT.md).
