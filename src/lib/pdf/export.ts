// Writes the nested layout back out as a PDF that Illustrator opens.
//
// Nothing is redrawn. The original page is embedded once as a form, and each
// sticker is that same form drawn again with a clip set to its cut contour and
// a transform putting it where the engine asked. Vectors, raster images, spot
// colours and overprint all survive, because none of them are ever
// reinterpreted: the bytes that described them are simply referenced again.
//
// Redrawing from the extracted geometry would have been easier and would have
// thrown away every image on the sheet and every colour space the extractor
// does not understand.

import {
  PDFDocument,
  clip,
  closePath,
  concatTransformationMatrix,
  drawObject,
  endPath,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  appendBezierCurve,
} from "pdf-lib";

import type { VectorPath } from "./extract";
import type { NestPlacement, NestResult } from "@/lib/engine";
import type { SheetSettings } from "@/lib/settings";

const MM_TO_PT = 72 / 25.4;

/** The cut contour as PDF path operators, in the source page's coordinates. */
function clipOperators(path: VectorPath) {
  const operators = [moveTo(path.start.x, path.start.y)];
  for (const segment of path.segments)
    operators.push(
      appendBezierCurve(
        segment.c1.x,
        segment.c1.y,
        segment.c2.x,
        segment.c2.y,
        segment.end.x,
        segment.end.y
      )
    );
  operators.push(closePath());
  return operators;
}

export interface ExportOptions {
  sourceBytes: Uint8Array;
  result: NestResult;
  pathForDesign: Map<number, VectorPath>;
  sheet: SheetSettings;
}

export async function exportNestedPdf({
  sourceBytes,
  result,
  pathForDesign,
  sheet,
}: ExportOptions): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const [embedded] = await out.embedPdf(sourceBytes, [0]);

  const widthPt = sheet.widthMm * MM_TO_PT;
  const heightPt = sheet.heightMm * MM_TO_PT;

  const bySheet = new Map<number, NestPlacement[]>();
  for (const placement of result.placements) {
    const list = bySheet.get(placement.sheetIndex) ?? [];
    list.push(placement);
    bySheet.set(placement.sheetIndex, list);
  }

  for (const sheetIndex of [...bySheet.keys()].sort((a, b) => a - b)) {
    const page = out.addPage([widthPt, heightPt]);
    // One XObject entry per page, reused by every sticker on it.
    const name = page.node.newXObject("Sticker", embedded.ref);

    for (const placement of bySheet.get(sheetIndex)!) {
      const path = pathForDesign.get(placement.designIndex);
      if (!path) continue;

      const radians = (placement.rotationDeg * Math.PI) / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);

      page.pushOperators(
        pushGraphicsState(),
        // Rotate about the page origin, then move, which is the transform the
        // engine's placement describes. The clip below is given in the source
        // page's own coordinates and is carried along by this.
        concatTransformationMatrix(
          cos,
          sin,
          -sin,
          cos,
          placement.x * MM_TO_PT,
          placement.y * MM_TO_PT
        ),
        ...clipOperators(path),
        clip(),
        endPath(),
        drawObject(name),
        popGraphicsState()
      );
    }
  }

  return out.save();
}
