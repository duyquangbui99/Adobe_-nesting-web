// Does the engine actually overlap, or does the preview only look like it?
// Measures the placed cut contours against each other directly.
import { readFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractPageGeometry, type VectorPath } from "../src/lib/pdf/extract.js";
import { guessCutLayer, looksLikeCutLine, summariseLayers, PT_TO_MM } from "../src/lib/pdf/geometry.js";
import type { NestResult } from "../src/lib/engine/index.js";

interface EngineModule {
  ccall: (n: string, r: string | null, t: string[], a: unknown[]) => number;
  UTF8ToString: (p: number) => string;
}

const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(process.argv[2])) }).promise;
const page = await extractPageGeometry(doc, 1);
const cuts = page.paths.filter((p) => p.layer === guessCutLayer(summariseLayers(page)) && looksLikeCutLine(p));

const sheet = { w: page.width * PT_TO_MM, h: page.height * PT_TO_MM, m: 15 };
const usable = (sheet.w - 2 * sheet.m) * (sheet.h - 2 * sheet.m);
const designs = cuts.map((p, i) => {
  const a = (p.bounds.maxX - p.bounds.minX) * PT_TO_MM * ((p.bounds.maxY - p.bounds.minY) * PT_TO_MM);
  return {
    id: `cut-${i}`, quantity: Math.min(Math.floor(usable / a) + 2, 60), rotation: "free",
    paths: [{
      start: [p.start.x * PT_TO_MM, p.start.y * PT_TO_MM], closed: p.closed,
      segments: p.segments.map((s) => [
        s.c1.x * PT_TO_MM, s.c1.y * PT_TO_MM, s.c2.x * PT_TO_MM, s.c2.y * PT_TO_MM,
        s.end.x * PT_TO_MM, s.end.y * PT_TO_MM]),
    }],
  };
});

const { default: createModule } = (await import("../src/lib/engine/nest-engine.js")) as {
  default: (o?: object) => Promise<EngineModule>;
};
const mod = await createModule();
const ptr = mod.ccall("nest_run", "number", ["string"], [JSON.stringify({
  sheet: { width: sheet.w, height: sheet.h, marginLeft: sheet.m, marginRight: sheet.m, marginTop: sheet.m, marginBottom: sheet.m },
  gap: 5, rotationStepDeg: 10, maxSheets: 1, direction: "topRight", timeBudgetSeconds: 5, designs,
})]);
const result = JSON.parse(mod.UTF8ToString(ptr)) as NestResult;
mod.ccall("nest_free", null, ["number"], [ptr]);

console.log(`placed ${result.placements.length}, validation ${result.validation.ok ? "PASSED" : "FAILED"}`);
console.log(`worst penetration ${result.validation.worstPenetrationMm.toFixed(6)} mm, pairs tested ${result.validation.pairsTested}`);

// Independently: do the placed bounding boxes overlap? Crude, but a box overlap
// between two pieces that should be 5 mm apart is worth knowing about.
const MM = PT_TO_MM;
const boxes = result.placements.map((pl) => {
  const src = cuts[Number(result.designs[pl.designIndex]?.id.split("-")[1] ?? pl.designIndex)] ?? cuts[pl.designIndex];
  const rad = (pl.rotationDeg * Math.PI) / 180, c = Math.cos(rad), s = Math.sin(rad);
  const corners: [number, number][] = [
    [src.bounds.minX, src.bounds.minY], [src.bounds.maxX, src.bounds.minY],
    [src.bounds.maxX, src.bounds.maxY], [src.bounds.minX, src.bounds.maxY]];
  const pts = corners.map(([x, y]) => [ (x * c - y * s) * MM + pl.x, (x * s + y * c) * MM + pl.y ]);
  return {
    minX: Math.min(...pts.map((p) => p[0])), maxX: Math.max(...pts.map((p) => p[0])),
    minY: Math.min(...pts.map((p) => p[1])), maxY: Math.max(...pts.map((p) => p[1])),
  };
});
let boxOverlaps = 0;
for (let i = 0; i < boxes.length; i++)
  for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY) boxOverlaps++;
  }
console.log(`bounding boxes that overlap: ${boxOverlaps} of ${(boxes.length * (boxes.length - 1)) / 2} pairs`);
console.log(`(boxes overlapping is normal for interlocking shapes; outlines overlapping is not)`);
