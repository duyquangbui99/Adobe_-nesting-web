// Writes the nested layout back out as a PDF a cutter can actually use.
//
// Three things go onto the page, and only the first is about looking right.
//
// The artwork: the source page embedded once as a form, drawn again per
// sticker, clipped to that sticker's cut contour and transformed into place.
// Nothing is redrawn, so vectors, raster images, spot colours and overprint all
// survive, because none of them are reinterpreted.
//
// The cut contours: the same outlines as unfilled stroked paths on a layer of
// their own, stroked in a spot colour named CutContour. Without these the sheet
// prints and cannot be cut: a RIP finds the blade path by that name. They are
// drawn separately rather than relied upon from inside the clip, where only the
// inner half of the stroke survives and nothing can isolate them.
//
// The registration marks: redrawn at the corners of the new sheet, at the size
// and inset the source used. Without them the cutter cannot find the sheet.
//
// And the source's own layers, which come along inside the embedded form. The
// two we replace have to be switched off by name, or they print. See below.

import {
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFOperator,
  PDFOperatorNames,
  PDFString,
  appendBezierCurve,
  clip,
  closePath,
  concatTransformationMatrix,
  drawObject,
  endPath,
  fill,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  setLineWidth,
  stroke,
} from "pdf-lib";
import type { PDFPage, PDFRef } from "pdf-lib";

import type { VectorPath } from "./extract";
import type { RegistrationMarks } from "./marks";
import type { NestPlacement, NestResult } from "@/lib/engine";
import type { SheetSettings } from "@/lib/settings";

const MM_TO_PT = 72 / 25.4;

/** A path as PDF operators, in whatever space the current transform defines. */
function pathOperators(path: VectorPath, dx = 0, dy = 0) {
  const operators = [moveTo(path.start.x + dx, path.start.y + dy)];
  for (const s of path.segments)
    operators.push(
      appendBezierCurve(s.c1.x + dx, s.c1.y + dy, s.c2.x + dx, s.c2.y + dy, s.end.x + dx, s.end.y + dy)
    );
  operators.push(closePath());
  return operators;
}

function beginLayer(property: string) {
  return PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [
    PDFName.of("OC"),
    PDFName.of(property),
  ]);
}

const endLayer = () => PDFOperator.of(PDFOperatorNames.EndMarkedContent);

function setStrokeSpot(colorSpace: string, tint: number) {
  return [
    PDFOperator.of(PDFOperatorNames.StrokingColorspace, [PDFName.of(colorSpace)]),
    PDFOperator.of(PDFOperatorNames.StrokingColorN, [String(tint)]),
  ];
}

/** Adds a key to a page's Resources sub-dictionary, creating it if needed. */
function addResource(page: PDFPage, category: string, key: string, value: PDFRef) {
  const resources = page.node.Resources()!;
  let bucket = resources.lookup(PDFName.of(category)) as PDFDict | undefined;
  if (!bucket) {
    bucket = page.doc.context.obj({}) as PDFDict;
    resources.set(PDFName.of(category), bucket);
  }
  bucket.set(PDFName.of(key), value);
}

export interface ExportOptions {
  sourceBytes: Uint8Array;
  result: NestResult;
  pathForDesign: Map<number, VectorPath>;
  sheet: SheetSettings;
  /** Redrawn on the output sheet. Omitted when the source had none. */
  marks: RegistrationMarks | null;
  /**
   * Names of the source's own layers to switch off, because this file draws
   * their content itself. The cut layer belongs here; without it the shop's
   * cut line prints.
   */
  hiddenLayers?: string[];
}

export async function exportNestedPdf({
  sourceBytes,
  result,
  pathForDesign,
  sheet,
  marks,
  hiddenLayers = [],
}: ExportOptions): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const [embedded] = await out.embedPdf(sourceBytes, [0]);
  const context = out.context;

  // Layers, so a RIP or an operator can isolate the cut from the print.
  const layerRefs: Record<string, PDFRef> = {};
  for (const name of ["Print", "CutContour", "Registration"])
    layerRefs[name] = context.register(
      context.obj({ Type: "OCG", Name: PDFString.of(name) })
    );
  const allLayers = Object.values(layerRefs);

  // A Separation called CutContour, which is how every print-and-cut RIP finds
  // the blade path. The tint transform paints it magenta so a human can see it.
  const cutTint = context.register(
    context.obj({ FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: [0, 1, 0, 0], N: 1 })
  );
  const cutSpace = context.register(
    context.obj([PDFName.of("Separation"), PDFName.of("CutContour"), PDFName.of("DeviceCMYK"), cutTint])
  );

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
    const artwork = page.node.newXObject("Sticker", embedded.ref);
    addResource(page, "ColorSpace", "CutCS", cutSpace);
    for (const [name, ref] of Object.entries(layerRefs))
      addResource(page, "Properties", name, ref);

    const placements = bySheet.get(sheetIndex)!;

    // Artwork first, so the cut lines and marks draw over it.
    page.pushOperators(beginLayer("Print"));
    for (const placement of placements) {
      const path = pathForDesign.get(placement.designIndex);
      if (!path) continue;
      const radians = (placement.rotationDeg * Math.PI) / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      page.pushOperators(
        pushGraphicsState(),
        // Rotate about the page origin, then move. The clip below is given in
        // the source page's own coordinates and is carried along by this.
        concatTransformationMatrix(cos, sin, -sin, cos, placement.x * MM_TO_PT, placement.y * MM_TO_PT),
        ...pathOperators(path),
        clip(),
        endPath(),
        drawObject(artwork),
        popGraphicsState()
      );
    }
    page.pushOperators(endLayer());

    page.pushOperators(beginLayer("CutContour"));
    for (const placement of placements) {
      const path = pathForDesign.get(placement.designIndex);
      if (!path) continue;
      const radians = (placement.rotationDeg * Math.PI) / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      page.pushOperators(
        pushGraphicsState(),
        concatTransformationMatrix(cos, sin, -sin, cos, placement.x * MM_TO_PT, placement.y * MM_TO_PT),
        ...setStrokeSpot("CutCS", 1),
        // A quarter point. The blade follows the path's centre, so the weight
        // is only there to be seen.
        setLineWidth(0.25),
        ...pathOperators(path),
        stroke(),
        popGraphicsState()
      );
    }
    page.pushOperators(endLayer());

    if (marks) {
      page.pushOperators(beginLayer("Registration"));
      const insetX = marks.insetXMm * MM_TO_PT;
      const insetY = marks.insetYMm * MM_TO_PT;
      const source = {
        x: (marks.shape.bounds.minX + marks.shape.bounds.maxX) / 2,
        y: (marks.shape.bounds.minY + marks.shape.bounds.maxY) / 2,
      };
      const corners = [
        { x: insetX, y: insetY },
        { x: widthPt - insetX, y: insetY },
        { x: insetX, y: heightPt - insetY },
        { x: widthPt - insetX, y: heightPt - insetY },
      ];
      for (const corner of corners)
        page.pushOperators(
          pushGraphicsState(),
          PDFOperator.of(PDFOperatorNames.NonStrokingColorCmyk, ["0", "0", "0", "1"]),
          ...pathOperators(marks.shape, corner.x - source.x, corner.y - source.y),
          fill(),
          popGraphicsState()
        );
      page.pushOperators(endLayer());
    }
  }

  // The source's layers arrive inside the embedded form, and an optional
  // content group that no configuration mentions is visible by default. For the
  // cut layer that is not cosmetic: its stroke sits exactly under our clip, so
  // the inner half of it survives on every single sticker and prints as a rim
  // the blade then leaves behind. The fix is to name the source's groups and
  // switch off the ones this file already draws for itself.
  await out.flush(); // The embedded page's objects only reach us on a flush.
  const ours = new Set(allLayers.map((ref) => ref.objectNumber));
  const wanted = new Set(hiddenLayers);
  const sourceLayers: PDFRef[] = [];
  const suppressed: PDFRef[] = [];
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (ours.has(ref.objectNumber)) continue;
    if (!(object instanceof PDFDict)) continue;
    if (object.lookup(PDFName.of("Type")) !== PDFName.of("OCG")) continue;
    sourceLayers.push(ref);
    const name = object.lookup(PDFName.of("Name"));
    const label =
      name instanceof PDFHexString || name instanceof PDFString ? name.decodeText() : null;
    if (label !== null && wanted.has(label)) suppressed.push(ref);
  }

  const off = new Set(suppressed.map((ref) => ref.objectNumber));
  out.catalog.set(
    PDFName.of("OCProperties"),
    context.obj({
      OCGs: [...allLayers, ...sourceLayers],
      D: {
        ON: [...allLayers, ...sourceLayers.filter((ref) => !off.has(ref.objectNumber))],
        OFF: suppressed,
        // Only ours are ordered, so the layer panel shows the three that mean
        // something here and not the source's.
        Order: allLayers,
      },
    })
  );

  return out.save();
}
