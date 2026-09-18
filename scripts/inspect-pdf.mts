// Runs the extractor against a PDF outside the browser, so the reading can be
// checked without any UI. The web app and this share one implementation.
//
//   npm run inspect -- path/to/file.pdf
import { readFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractPageGeometry } from "../src/lib/pdf/extract.js";

const PT_TO_MM = 25.4 / 72;
const file = process.argv[2];
if (!file) {
  console.error("usage: npm run inspect -- <file.pdf>");
  process.exit(2);
}

const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)) }).promise;
const page = await extractPageGeometry(doc, 1);

console.log(`page    ${(page.width * PT_TO_MM).toFixed(1)} x ${(page.height * PT_TO_MM).toFixed(1)} mm`);
console.log(`paths   ${page.paths.length}`);
console.log(`layers  ${page.layers.join(", ") || "none"}`);
console.log(`skipped ${page.skipped.images} images, ${page.skipped.text} text runs, ${page.skipped.shading} shadings`);

for (const layer of [...page.layers, null]) {
  const onLayer = page.paths.filter((p) => p.layer === layer);
  if (!onLayer.length) continue;
  const closed = onLayer.filter((p) => p.closed);
  // A closed path that is stroked but not filled is how a cut contour looks
  // when a shop marks it by layer rather than by a named spot colour.
  const cutLike = closed.filter((p) => p.stroked && !p.filled);
  console.log(`\n${layer ?? "(no layer)"}: ${onLayer.length} paths, ${closed.length} closed, ${cutLike.length} look like cut lines`);
  for (const p of cutLike) {
    const w = (p.bounds.maxX - p.bounds.minX) * PT_TO_MM;
    const h = (p.bounds.maxY - p.bounds.minY) * PT_TO_MM;
    console.log(`    ${w.toFixed(2)} x ${h.toFixed(2)} mm, ${p.segments.length} segments`);
  }
}
