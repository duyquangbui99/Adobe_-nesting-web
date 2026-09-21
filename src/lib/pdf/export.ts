// Writes the nested layout back out as a PDF a cutter can actually use.
//
// Three things go onto the page, and only the first is about looking right.
//
// The artwork: the source page embedded once as a form, then cut down to one
// form per design holding only what can paint inside that design's contour,
// drawn per sticker and still clipped to that contour. Nothing is redrawn, so
// vectors, raster images, spot colours and overprint all survive, because none
// of them are reinterpreted. The trim removes only what the clip was already
// hiding, which is what stops Illustrator opening a seven-design sheet with
// all seven designs inside every sticker.
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
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFOperator,
  PDFRawStream,
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
  decodePDFRawStream,
} from "pdf-lib";
import type { PDFObject, PDFPage, PDFRef } from "pdf-lib";

import { trimContent, type Box, type Matrix, type XObjectInfo } from "./trim";
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

/** Stroke weights and join miters reach past a path's own bounds. */
const TRIM_MARGIN_PT = 2;

function boxOf(path: VectorPath): Box {
  return {
    minX: path.bounds.minX - TRIM_MARGIN_PT,
    minY: path.bounds.minY - TRIM_MARGIN_PT,
    maxX: path.bounds.maxX + TRIM_MARGIN_PT,
    maxY: path.bounds.maxY + TRIM_MARGIN_PT,
  };
}

/** Tells the trimmer how big each XObject the stream draws actually is. */
function xObjectLookup(doc: PDFDocument, resources: PDFObject | undefined) {
  const dictionary = resources
    ? doc.context.lookupMaybe(resources, PDFDict)
    : undefined;
  const bucket = dictionary
    ? doc.context.lookupMaybe(dictionary.get(PDFName.of("XObject")), PDFDict)
    : undefined;

  return (name: string): XObjectInfo => {
    if (!bucket) return null;  // unknown, so the trimmer keeps it
    const entry = doc.context.lookup(bucket.get(PDFName.of(name)));
    if (!(entry instanceof PDFRawStream)) return null;
    const dict = entry.dict;
    if (dict.get(PDFName.of("Subtype")) === PDFName.of("Image")) return { kind: "image" };

    const box = doc.context.lookupMaybe(dict.get(PDFName.of("BBox")), PDFArray);
    if (!box || box.size() < 4) return null;
    const at = (array: PDFArray, i: number) => array.lookup(i, PDFNumber).asNumber();
    const matrix = doc.context.lookupMaybe(dict.get(PDFName.of("Matrix")), PDFArray);
    return {
      kind: "form",
      bbox: {
        minX: Math.min(at(box, 0), at(box, 2)),
        minY: Math.min(at(box, 1), at(box, 3)),
        maxX: Math.max(at(box, 0), at(box, 2)),
        maxY: Math.max(at(box, 1), at(box, 3)),
      },
      matrix:
        matrix && matrix.size() >= 6
          ? (Array.from({ length: 6 }, (_, i) => at(matrix, i)) as Matrix)
          : [1, 0, 0, 1, 0, 0],
    };
  };
}

/**
 * One form per design, holding only the operations that can paint inside that
 * design's contour.
 *
 * A design with nothing to drop is left out and the caller draws the whole page
 * for it instead, as is every design if the source's content cannot be read at
 * all. An untrimmed sheet is only heavy, and heavy beats wrong.
 */
function buildStickerForms(
  doc: PDFDocument,
  pageForm: PDFRef,
  pathForDesign: Map<number, VectorPath>
): Map<number, PDFRef> {
  const forms = new Map<number, PDFRef>();

  const stream = doc.context.lookup(pageForm);
  if (!(stream instanceof PDFRawStream)) return forms;

  let content: Uint8Array;
  try {
    content = decodePDFRawStream(stream).decode();
  } catch {
    return forms;
  }

  // The clip and the cut contours are written in the page's own coordinates,
  // and so is the target box below. That only holds while the embedded form
  // does not transform its contents. It never has yet, and if it ever does the
  // untrimmed sheet is still correct.
  const matrix = doc.context.lookupMaybe(stream.dict.get(PDFName.of("Matrix")), PDFArray);
  if (matrix) {
    const identity = [1, 0, 0, 1, 0, 0];
    const same =
      matrix.size() === 6 &&
      identity.every((v, i) => Math.abs(matrix.lookup(i, PDFNumber).asNumber() - v) < 1e-9);
    if (!same) return forms;
  }

  const resources = stream.dict.get(PDFName.of("Resources"));
  const lookup = xObjectLookup(doc, resources);

  for (const [designIndex, path] of pathForDesign) {
    const target = boxOf(path);
    let trimmed;
    try {
      trimmed = trimContent(content, target, lookup);
    } catch {
      continue;
    }
    if (trimmed.dropped === 0) continue;

    const form = doc.context.flateStream(trimmed.bytes, {
      Type: "XObject",
      Subtype: "Form",
      FormType: 1,
      // Tight to the design, so Illustrator stops drawing a page-sized box
      // around every sticker.
      BBox: [target.minX, target.minY, target.maxX, target.maxY],
      Matrix: [1, 0, 0, 1, 0, 0],
      ...(resources ? { Resources: resources } : {}),
    });
    forms.set(designIndex, doc.context.register(form));
  }
  return forms;
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
  /**
   * Cut each design's artwork down to itself. Off, every sticker carries the
   * whole source page behind its clip, which is heavier but is exactly what a
   * PDF reader saw before the trim existed.
   */
  trimArtwork?: boolean;
}

export async function exportNestedPdf({
  sourceBytes,
  result,
  pathForDesign,
  sheet,
  marks,
  hiddenLayers = [],
  trimArtwork = true,
}: ExportOptions): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const [embedded] = await out.embedPdf(sourceBytes, [0]);
  const context = out.context;

  // The embedded page's own objects only reach this document on a flush, and
  // the trim reads them.
  await out.flush();
  const stickerForms = trimArtwork
    ? buildStickerForms(out, embedded.ref, pathForDesign)
    : new Map<number, PDFRef>();

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

  // When every design was trimmed, the page it was all cut out of is left in
  // the file referenced by nothing, which is a megabyte of nothing.
  let wholePageDrawn = false;

  const bySheet = new Map<number, NestPlacement[]>();
  for (const placement of result.placements) {
    const list = bySheet.get(placement.sheetIndex) ?? [];
    list.push(placement);
    bySheet.set(placement.sheetIndex, list);
  }

  for (const sheetIndex of [...bySheet.keys()].sort((a, b) => a - b)) {
    const page = out.addPage([widthPt, heightPt]);
    addResource(page, "ColorSpace", "CutCS", cutSpace);
    for (const [name, ref] of Object.entries(layerRefs))
      addResource(page, "Properties", name, ref);

    const placements = bySheet.get(sheetIndex)!;

    // Each design draws its own trimmed form, or the whole page when there was
    // nothing worth trimming out of it.
    const artworkFor = new Map<number, PDFName>();
    for (const placement of placements)
      if (!artworkFor.has(placement.designIndex)) {
        const trimmed = stickerForms.get(placement.designIndex);
        if (!trimmed) wholePageDrawn = true;
        artworkFor.set(
          placement.designIndex,
          page.node.newXObject(`Sticker${placement.designIndex}`, trimmed ?? embedded.ref)
        );
      }

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
        drawObject(artworkFor.get(placement.designIndex)!),
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

  if (!wholePageDrawn) context.delete(embedded.ref);

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
