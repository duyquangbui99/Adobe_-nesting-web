import { readFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractPageGeometry } from "../src/lib/pdf/extract.js";
import { guessCutLayer, looksLikeCutLine, summariseLayers, PT_TO_MM } from "../src/lib/pdf/geometry.js";
interface EngineModule { ccall: (n: string, r: string|null, t: string[], a: unknown[]) => number; UTF8ToString: (p: number) => string; }
const { default: createModule } = (await import("../src/lib/engine/nest-engine.js")) as { default: (o?: object) => Promise<EngineModule> };

const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(process.argv[2])) }).promise;
const page = await extractPageGeometry(doc, 1);
const cuts = page.paths.filter((p) => p.layer === guessCutLayer(summariseLayers(page)) && looksLikeCutLine(p));
const toEngine = (p: (typeof cuts)[number]) => ({
  start: [p.start.x * PT_TO_MM, p.start.y * PT_TO_MM], closed: p.closed,
  segments: p.segments.map((s) => [s.c1.x*PT_TO_MM, s.c1.y*PT_TO_MM, s.c2.x*PT_TO_MM, s.c2.y*PT_TO_MM, s.end.x*PT_TO_MM, s.end.y*PT_TO_MM]),
});
const mod = await createModule();

console.log("sheet      step  budget  placed  util%   gens  VALID  worstPen");
for (const sheet of [[330,480],[860,1260]] as const)
for (const step of [90, 15, 10, 5, 2, 1])
for (const budget of [2, 6]) {
  const request = {
    sheet: { width: sheet[0], height: sheet[1], marginLeft: 15, marginRight: 15, marginTop: 15, marginBottom: 15 },
    gap: 5, rotationStepDeg: step, maxSheets: 1, direction: "topRight", timeBudgetSeconds: budget,
    designs: cuts.map((p, i) => ({ id: `cut-${i}`, quantity: 10, rotation: "free", paths: [toEngine(p)] })),
  };
  const ptr = mod.ccall("nest_run", "number", ["string"], [JSON.stringify(request)]);
  const out = JSON.parse(mod.UTF8ToString(ptr));
  mod.ccall("nest_free", null, ["number"], [ptr]);
  const v = out.validation;
  console.log(
    `${(sheet[0]+"x"+sheet[1]).padEnd(10)} ${String(step).padStart(3)}  ${String(budget).padStart(5)}` +
    `  ${String(out.placements?.length).padStart(6)}  ${(out.utilization*100).toFixed(1).padStart(5)}` +
    `  ${String(out.generations).padStart(5)}  ${v.ok ? "ok   " : "FAIL "}  ${v.worstPenetrationMm.toFixed(4)}` +
    (v.ok ? "" : `   violations=${v.violations.length}`)
  );
}
