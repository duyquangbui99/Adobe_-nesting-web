// Exports the same nest twice, trimmed and untrimmed, and checks that the two
// render identically. The trim may only remove what the clip already hid, so
// any pixel difference is a bug.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractPageGeometry } from "../src/lib/pdf/extract.js";
import { guessCutLayer, holdsOnlyCutLines, looksLikeCutLine, summariseLayers, PT_TO_MM } from "../src/lib/pdf/geometry.js";
import { findRegistrationMarks } from "../src/lib/pdf/marks.js";
import { exportNestedPdf } from "../src/lib/pdf/export.js";
interface M { ccall: (n: string, r: string|null, t: string[], a: unknown[]) => number; UTF8ToString: (p: number) => string; }
const { default: createModule } = (await import("../src/lib/engine/nest-engine.js")) as { default: (o?: object) => Promise<M> };
const mod = await createModule();
const OUT = "/private/tmp/claude-501/-Users-quangbui-Desktop-adobe-plugin/686f6a76-522f-4673-a4bb-030026ffa996/scratchpad/";

for (const file of process.argv.slice(2)) {
  const bytes = new Uint8Array(readFileSync(file));
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const page = await extractPageGeometry(doc, 1);
  const layers = summariseLayers(page);
  const cutLayer = guessCutLayer(layers);
  const cuts = page.paths.filter((p) => p.layer === cutLayer && looksLikeCutLine(p));
  const toEngine = (p: (typeof cuts)[number]) => ({
    start: [p.start.x*PT_TO_MM, p.start.y*PT_TO_MM], closed: p.closed,
    segments: p.segments.map((s)=>[s.c1.x*PT_TO_MM,s.c1.y*PT_TO_MM,s.c2.x*PT_TO_MM,s.c2.y*PT_TO_MM,s.end.x*PT_TO_MM,s.end.y*PT_TO_MM]),
  });
  const sheet = { widthMm: 330, heightMm: 480, marginMm: 15 };
  const request = {
    sheet: { width: 330, height: 480, marginLeft: 15, marginRight: 15, marginTop: 15, marginBottom: 15 },
    gap: 5, rotationStepDeg: 10, maxSheets: 1, direction: "topRight", timeBudgetSeconds: 3,
    designs: cuts.map((p, i) => ({ id: `c${i}`, quantity: 4, rotation: "free", paths: [toEngine(p)] })),
  };
  const ptr = mod.ccall("nest_run","number",["string"],[JSON.stringify(request)]);
  const result = JSON.parse(mod.UTF8ToString(ptr));
  mod.ccall("nest_free", null, ["number"], [ptr]);

  const pathForDesign = new Map<number, (typeof cuts)[number]>();
  result.designs?.forEach((r: { designIndex: number }, i: number) => {
    if (r.designIndex >= 0) pathForDesign.set(r.designIndex, cuts[i]);
  });
  const marks = findRegistrationMarks(page);
  const marksLayer = marks?.shape.layer ?? null;
  const onMarksLayer = page.paths.filter((p) => p.layer === marksLayer).length;
  const cutSummary = layers.find((l) => l.name === cutLayer);
  const hiddenLayers = [
    cutLayer !== null && cutSummary && holdsOnlyCutLines(cutSummary) ? cutLayer : null,
    marksLayer !== null && onMarksLayer === marks!.found ? marksLayer : null,
  ].filter((n): n is string => n !== null);

  const name = file.split("/").pop()!.replace(/\.pdf$/i, "");
  const sizes: Record<string, number> = {};
  for (const trim of [false, true]) {
    const pdf = await exportNestedPdf({
      sourceBytes: bytes.slice(), result, pathForDesign: pathForDesign as never,
      sheet: sheet as never, marks, hiddenLayers, trimArtwork: trim,
    });
    const out = `${OUT}${name}-${trim ? "trim" : "full"}.pdf`;
    writeFileSync(out, pdf);
    sizes[trim ? "trim" : "full"] = pdf.length;
    execFileSync("sips", ["-s","format","jpeg","--resampleWidth","2200", out, "--out", out.replace(/\.pdf$/, ".jpg")], { stdio: "ignore" });
  }
  const a = readFileSync(`${OUT}${name}-full.jpg`);
  const b = readFileSync(`${OUT}${name}-trim.jpg`);
  // Past the JPEG metadata, which carries the second the file was written.
  const same = a.length === b.length && a.subarray(1024).equals(b.subarray(1024));
  console.log(`${name.padEnd(14)} placed ${String(result.placements.length).padStart(3)}  ` +
    `full ${(sizes.full/1048576).toFixed(2)} MB -> trimmed ${(sizes.trim/1048576).toFixed(2)} MB  ` +
    `(${Math.round(100 - 100*sizes.trim/sizes.full)}% smaller)   render ${same ? "IDENTICAL" : "*** DIFFERS ***"}`);
}
