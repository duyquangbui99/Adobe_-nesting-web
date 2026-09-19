// What does this sheet carry besides stickers? The cutter needs registration
// marks to find the sheet, and they have to end up on the nested one too.
import { readFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractPageGeometry } from "../src/lib/pdf/extract.js";
import { PT_TO_MM } from "../src/lib/pdf/geometry.js";

const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(process.argv[2])) }).promise;
const page = await extractPageGeometry(doc, 1);
const W = page.width, H = page.height;
console.log(`page ${(W * PT_TO_MM).toFixed(1)} x ${(H * PT_TO_MM).toFixed(1)} mm\n`);

for (const layer of page.layers) {
  const on = page.paths.filter((p) => p.layer === layer);
  console.log(`${layer}: ${on.length} paths`);
  for (const p of on) {
    const w = (p.bounds.maxX - p.bounds.minX) * PT_TO_MM;
    const h = (p.bounds.maxY - p.bounds.minY) * PT_TO_MM;
    // Anything small and near a corner is a candidate mark.
    const cx = (p.bounds.minX + p.bounds.maxX) / 2;
    const cy = (p.bounds.minY + p.bounds.maxY) / 2;
    if (w < 30 && h < 30)
      console.log(
        `   ${w.toFixed(1)} x ${h.toFixed(1)} mm  centre (${(cx * PT_TO_MM).toFixed(1)}, ${(cy * PT_TO_MM).toFixed(1)}) mm` +
        `  inset L${(cx * PT_TO_MM).toFixed(1)} R${((W - cx) * PT_TO_MM).toFixed(1)}` +
        ` B${(cy * PT_TO_MM).toFixed(1)} T${((H - cy) * PT_TO_MM).toFixed(1)}` +
        `  ${p.filled ? "filled" : ""}${p.stroked ? " stroked" : ""} ${p.segments.length} segs`
      );
  }
}
