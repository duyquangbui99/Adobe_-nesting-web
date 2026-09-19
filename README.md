# Sticker Nest

Re-nests a print-and-cut PDF in the browser and writes back a sheet a cutter can
use. Reads the cut contours out of the file, packs them with the same C++ engine
the Illustrator plugin uses, compiled to WebAssembly, and exports a PDF that
Illustrator opens with the artwork, the cut layer and the registration marks
intact.

Nothing is uploaded. The PDF is read, nested and written entirely in the tab, so
a customer's artwork never leaves their machine.

## Running it

```sh
npm install
npm run dev
```

Then open http://localhost:3000 and drop a PDF on it.

`npm run inspect -- file.pdf` runs the same extractor outside the browser, which
is the quickest way to see what a file actually contains.

## Deploying

There is no backend. Every part of it runs in the browser, so the whole thing is
static and needs no environment variables, no database and no serverless
functions.

On Vercel: import the repository, accept the detected Next.js settings, deploy.

Two files are committed rather than generated, and both need to stay that way:

- `public/nest-engine.wasm` and `src/lib/engine/nest-engine.js` are the compiled
  engine. Committing them means nobody working on the web app needs a C++
  toolchain. Rebuilding them is the only thing that does.
- `public/pdf.worker.mjs` is pdf.js's worker, copied out of `node_modules` by the
  `postinstall` script. It is committed as well so a deploy does not depend on
  that script having run.

## Rebuilding the engine

Only needed when the C++ in the sibling `adobe-plugin` repository changes. It is
the one step that needs [Emscripten](https://emscripten.org).

```sh
cd ../adobe-plugin
emcmake cmake --preset wasm && cmake --build --preset wasm
cp build/wasm/wasm/nest-engine.js  ../Adobe-web/src/lib/engine/
cp build/wasm/wasm/nest-engine.wasm ../Adobe-web/src/lib/engine/
cp build/wasm/wasm/nest-engine.wasm ../Adobe-web/public/
```

## Known gaps

- One sheet only. The engine handles several; the interface pins it to one, so
  an order larger than a sheet reports pieces unplaced instead of starting a
  second page.
- The engine runs on the main thread, so the tab sits still for the length of
  the effort budget. A worker is the fix.
- A source file with no registration marks exports without them, and the result
  cannot be aligned in a cutter. The result panel says so.
