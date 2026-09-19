import { readFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractPageGeometry } from "../src/lib/pdf/extract.js";
import { findRegistrationMarks } from "../src/lib/pdf/marks.js";

const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(process.argv[2])) }).promise;
const marks = findRegistrationMarks(await extractPageGeometry(doc, 1));
console.log(marks
  ? `found ${marks.found} marks, ${marks.sizeMm.toFixed(1)} mm, inset ${marks.insetXMm.toFixed(1)} x ${marks.insetYMm.toFixed(1)} mm`
  : "no registration marks found");
