// End to end outside the browser: read a sheet, nest it, write the PDF out.
import { readFileSync, writeFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractPageGeometry } from "../src/lib/pdf/extract.js";
import { exportNestedPdf } from "../src/lib/pdf/export.js";
import { findRegistrationMarks } from "../src/lib/pdf/marks.js";
import { guessCutLayer, looksLikeCutLine, summariseLayers, PT_TO_MM } from "../src/lib/pdf/geometry.js";
import { defaultSheet } from "../src/lib/settings.js";
import type { NestResult } from "../src/lib/engine/index.js";

interface EngineModule {
  ccall: (n: string, r: string | null, t: string[], a: unknown[]) => number;
  UTF8ToString: (p: number) => string;
}

const file = process.argv[2];
const out = process.argv[3] ?? "/tmp/nested.pdf";
const bytes = new Uint8Array(readFileSync(file));

const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
const page = await extractPageGeometry(doc, 1);
const cutLayer = guessCutLayer(summariseLayers(page));
const cuts = page.paths.filter((p) => p.layer === cutLayer && looksLikeCutLine(p));

// Match the sheet to the file and fill it, which is the interesting case.
const sheet = { ...defaultSheet, widthMm: page.width * PT_TO_MM, heightMm: page.height * PT_TO_MM };
const usableMm2 =
  (sheet.widthMm - sheet.marginLeftMm - sheet.marginRightMm) *
  (sheet.heightMm - sheet.marginTopMm - sheet.marginBottomMm);

const designs = cuts.map((p, i) => {
  const areaMm2 =
    (p.bounds.maxX - p.bounds.minX) * PT_TO_MM * ((p.bounds.maxY - p.bounds.minY) * PT_TO_MM);
  return {
    id: `cut-${i}`,
    quantity: Math.min(Math.floor(usableMm2 / areaMm2) + 2, 400),
    rotation: "free",
    paths: [{
      start: [p.start.x * PT_TO_MM, p.start.y * PT_TO_MM],
      closed: p.closed,
      segments: p.segments.map((s) => [
        s.c1.x * PT_TO_MM, s.c1.y * PT_TO_MM,
        s.c2.x * PT_TO_MM, s.c2.y * PT_TO_MM,
        s.end.x * PT_TO_MM, s.end.y * PT_TO_MM,
      ]),
    }],
  };
});

const { default: createModule } = (await import("../src/lib/engine/nest-engine.js")) as {
  default: (o?: object) => Promise<EngineModule>;
};
const mod = await createModule();
const ptr = mod.ccall("nest_run", "number", ["string"], [JSON.stringify({
  sheet: {
    width: sheet.widthMm, height: sheet.heightMm,
    marginLeft: sheet.marginLeftMm, marginRight: sheet.marginRightMm,
    marginTop: sheet.marginTopMm, marginBottom: sheet.marginBottomMm,
  },
  gap: sheet.spacingMm, rotationStepDeg: 15, maxSheets: 1,
  direction: "topRight", timeBudgetSeconds: 5, designs,
})]);
const result = JSON.parse(mod.UTF8ToString(ptr)) as NestResult;
mod.ccall("nest_free", null, ["number"], [ptr]);

const pathForDesign = new Map<number, (typeof cuts)[number]>();
result.designs.forEach((d, i) => {
  if (d.designIndex >= 0 && cuts[i]) pathForDesign.set(d.designIndex, cuts[i]);
});

console.log(`asked for ${designs.reduce((n, d) => n + d.quantity, 0)}, placed ${result.placements.length}`);
console.log(`utilization ${(result.utilization * 100).toFixed(1)} %, validation ${result.validation.ok ? "passed" : "FAILED"}`);

const marks = findRegistrationMarks(page);
console.log(marks ? `registration marks ${marks.sizeMm.toFixed(1)} mm at ${marks.insetXMm.toFixed(0)} mm inset` : "no registration marks");
const pdf = await exportNestedPdf({ sourceBytes: bytes, result, pathForDesign, sheet, marks });
writeFileSync(out, pdf);
console.log(`wrote ${out}, ${(pdf.length / 1024).toFixed(0)} KB`);
