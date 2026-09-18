// Feeds the real sheet's cut contours to the WebAssembly engine with exactly
// the app's default settings, so a browser crash can be chased in node.
import { readFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractPageGeometry } from "../src/lib/pdf/extract.js";
import { guessCutLayer, looksLikeCutLine, summariseLayers, PT_TO_MM } from "../src/lib/pdf/geometry.js";
interface EngineModule {
  ccall: (n: string, r: string | null, t: string[], a: unknown[]) => number;
  UTF8ToString: (p: number) => string;
}
const { default: createModule } = (await import(
  "../src/lib/engine/nest-engine.js"
)) as { default: (o?: object) => Promise<EngineModule> };

const file = process.argv[2];
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)) }).promise;
const page = await extractPageGeometry(doc, 1);
const cutLayer = guessCutLayer(summariseLayers(page));
const cuts = page.paths.filter((p) => p.layer === cutLayer && looksLikeCutLine(p));

console.log(`cut layer ${cutLayer}, ${cuts.length} contours`);
for (const p of cuts)
  console.log(`   ${((p.bounds.maxX - p.bounds.minX) * PT_TO_MM).toFixed(1)} x ${((p.bounds.maxY - p.bounds.minY) * PT_TO_MM).toFixed(1)} mm, ${p.segments.length} segments`);

const toEngine = (p: (typeof cuts)[number]) => ({
  start: [p.start.x * PT_TO_MM, p.start.y * PT_TO_MM],
  closed: p.closed,
  segments: p.segments.map((s) => [
    s.c1.x * PT_TO_MM, s.c1.y * PT_TO_MM,
    s.c2.x * PT_TO_MM, s.c2.y * PT_TO_MM,
    s.end.x * PT_TO_MM, s.end.y * PT_TO_MM,
  ]),
});

const request = {
  sheet: { width: 860, height: 1260, marginLeft: 15, marginRight: 15, marginTop: 15, marginBottom: 15 },
  gap: 5,
  rotationStepDeg: 10,
  maxSheets: 1,
  direction: "topRight",
  timeBudgetSeconds: 2,
  designs: cuts.map((p, i) => ({ id: `cut-${i}`, quantity: 1, rotation: "free", paths: [toEngine(p)] })),
};

const { writeFileSync } = await import("node:fs");
writeFileSync("/tmp/nest-request.json", JSON.stringify(request));
console.log("request written to /tmp/nest-request.json");
if (process.env.DUMP_ONLY) process.exit(0);

const mod = await createModule();
console.log("\nrunning...");
const ptr = mod.ccall("nest_run", "number", ["string"], [JSON.stringify(request)]);
const out = JSON.parse(mod.UTF8ToString(ptr));
mod.ccall("nest_free", null, ["number"], [ptr]);
console.log(JSON.stringify({
  ok: out.ok, error: out.error,
  placed: out.placements?.length,
  util: Number((out.utilization * 100).toFixed(2)),
  firstLayoutSeconds: out.firstLayoutSeconds,
  elapsedSeconds: out.elapsedSeconds,
  generations: out.generations,
  evaluations: out.evaluations,
  nfpBuilt: out.nfpBuilt,
  nfpReused: out.nfpReused,
}, null, 1));
