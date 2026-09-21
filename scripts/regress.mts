import { readFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractPageGeometry } from "../src/lib/pdf/extract.js";
import { guessCutLayer, looksLikeCutLine, summariseLayers, PT_TO_MM } from "../src/lib/pdf/geometry.js";
interface M { ccall: (n: string, r: string|null, t: string[], a: unknown[]) => number; UTF8ToString: (p: number) => string; }
const { default: createModule } = (await import("../src/lib/engine/nest-engine.js")) as { default: (o?: object) => Promise<M> };
const mod = await createModule();
console.log("file                 qty/design  placed  util%   VALID   worstPen  gens  lattice");
for (const file of process.argv.slice(2)) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)) }).promise;
  const page = await extractPageGeometry(doc, 1);
  const cuts = page.paths.filter((p) => p.layer === guessCutLayer(summariseLayers(page)) && looksLikeCutLine(p));
  const toEngine = (p: (typeof cuts)[number]) => ({
    start: [p.start.x*PT_TO_MM, p.start.y*PT_TO_MM], closed: p.closed,
    segments: p.segments.map((s)=>[s.c1.x*PT_TO_MM,s.c1.y*PT_TO_MM,s.c2.x*PT_TO_MM,s.c2.y*PT_TO_MM,s.end.x*PT_TO_MM,s.end.y*PT_TO_MM]),
  });
  for (const qty of [1, 5, 20]) {
    const request = {
      sheet: { width: 330, height: 480, marginLeft: 15, marginRight: 15, marginTop: 15, marginBottom: 15 },
      gap: 5, rotationStepDeg: 10, maxSheets: 1, direction: "topRight", timeBudgetSeconds: 3,
      designs: cuts.map((p, i) => ({ id: `c${i}`, quantity: qty, rotation: "free", paths: [toEngine(p)] })),
    };
    const ptr = mod.ccall("nest_run","number",["string"],[JSON.stringify(request)]);
    const out = JSON.parse(mod.UTF8ToString(ptr));
    mod.ccall("nest_free", null, ["number"], [ptr]);
    console.log(`${file.split("/").pop()!.padEnd(20)} ${String(qty).padStart(9)}  ${String(out.placements?.length).padStart(6)}` +
      `  ${(out.utilization*100).toFixed(1).padStart(5)}  ${out.validation.ok?"ok   ":"FAIL "}  ${out.validation.worstPenetrationMm.toFixed(4).padStart(8)}` +
      `  ${String(out.generations).padStart(4)}  ${out.fromLattice}`);
  }
}
