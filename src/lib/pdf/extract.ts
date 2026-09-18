// Pulls vector geometry out of a PDF, grouped by the layer it sits on.
//
// Illustrator has thirty years of PDF import heuristics. This is a deliberately
// narrow slice of that: closed paths, their paint state, their layer, and their
// position in page coordinates. It is enough to nest a print-and-cut sheet and
// nothing more, which is the point.

import type { PDFDocumentProxy } from "pdfjs-dist";

export interface Point {
  x: number;
  y: number;
}

/** A cubic segment. Straight lines arrive with their controls on the chord. */
export interface Segment {
  c1: Point;
  c2: Point;
  end: Point;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface VectorPath {
  start: Point;
  segments: Segment[];
  closed: boolean;
  /** Painted with a fill, a stroke, or both. */
  filled: boolean;
  stroked: boolean;
  /** The optional content group it was drawn inside, if any. */
  layer: string | null;
  bounds: Bounds;
  /** Where it sat in the page's drawing order, so exports can preserve it. */
  order: number;
}

export interface PageGeometry {
  /** Page size in PDF points. */
  width: number;
  height: number;
  paths: VectorPath[];
  layers: string[];
  /** Drawing operations we recognised but could not turn into geometry. */
  skipped: { images: number; text: number; shading: number };
}

/** A 2D affine transform, in the order PDF stores it: a b c d e f. */
type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function apply(m: Matrix, x: number, y: number): Point {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

// pdf.js encodes a path as a flat number array prefixed by these codes.
const DRAW_MOVE_TO = 0;
const DRAW_LINE_TO = 1;
const DRAW_CURVE_TO = 2;
const DRAW_QUADRATIC_TO = 3;
const DRAW_CLOSE = 4;

/** A straight line as a cubic, with both controls on the chord. */
function lineSegment(from: Point, to: Point): Segment {
  return {
    c1: { x: from.x + (to.x - from.x) / 3, y: from.y + (to.y - from.y) / 3 },
    c2: { x: from.x + (2 * (to.x - from.x)) / 3, y: from.y + (2 * (to.y - from.y)) / 3 },
    end: to,
  };
}

function boundsOf(start: Point, segments: Segment[]): Bounds {
  const bounds: Bounds = { minX: start.x, minY: start.y, maxX: start.x, maxY: start.y };
  const note = (p: Point) => {
    if (p.x < bounds.minX) bounds.minX = p.x;
    if (p.x > bounds.maxX) bounds.maxX = p.x;
    if (p.y < bounds.minY) bounds.minY = p.y;
    if (p.y > bounds.maxY) bounds.maxY = p.y;
  };
  for (const segment of segments) {
    note(segment.c1);
    note(segment.c2);
    note(segment.end);
  }
  return bounds;
}

/**
 * Splits pdf.js's flat draw-op array into subpaths, each already transformed
 * into page coordinates. One PDF path operator can hold many subpaths, and each
 * is a separate shape as far as nesting is concerned.
 */
function decodePath(
  data: ArrayLike<number>,
  ctm: Matrix
): { start: Point; segments: Segment[]; closed: boolean }[] {
  const subpaths: { start: Point; segments: Segment[]; closed: boolean }[] = [];
  let current: { start: Point; segments: Segment[]; closed: boolean } | null = null;
  let pen: Point = { x: 0, y: 0 };

  const finish = () => {
    if (current && current.segments.length > 0) subpaths.push(current);
    current = null;
  };

  for (let i = 0; i < data.length; ) {
    switch (data[i++]) {
      case DRAW_MOVE_TO: {
        finish();
        pen = apply(ctm, data[i++], data[i++]);
        current = { start: pen, segments: [], closed: false };
        break;
      }
      case DRAW_LINE_TO: {
        const to = apply(ctm, data[i++], data[i++]);
        if (current) current.segments.push(lineSegment(pen, to));
        pen = to;
        break;
      }
      case DRAW_CURVE_TO: {
        const c1 = apply(ctm, data[i++], data[i++]);
        const c2 = apply(ctm, data[i++], data[i++]);
        const end = apply(ctm, data[i++], data[i++]);
        if (current) current.segments.push({ c1, c2, end });
        pen = end;
        break;
      }
      case DRAW_QUADRATIC_TO: {
        // Raise the degree: a quadratic is a cubic whose controls sit two
        // thirds of the way from each end towards the single control point.
        const q = apply(ctm, data[i++], data[i++]);
        const end = apply(ctm, data[i++], data[i++]);
        if (current)
          current.segments.push({
            c1: { x: pen.x + (2 / 3) * (q.x - pen.x), y: pen.y + (2 / 3) * (q.y - pen.y) },
            c2: { x: end.x + (2 / 3) * (q.x - end.x), y: end.y + (2 / 3) * (q.y - end.y) },
            end,
          });
        pen = end;
        break;
      }
      case DRAW_CLOSE: {
        if (current) {
          if (pen.x !== current.start.x || pen.y !== current.start.y)
            current.segments.push(lineSegment(pen, current.start));
          current.closed = true;
          pen = current.start;
        }
        break;
      }
      default:
        // An operator we do not know. Stopping is safer than guessing how many
        // numbers it would have consumed.
        i = data.length;
        break;
    }
  }
  finish();
  return subpaths;
}

export async function extractPageGeometry(
  doc: PDFDocumentProxy,
  pageNumber = 1
): Promise<PageGeometry> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });

  // Layer names live in the optional content configuration, keyed by the same
  // identifiers the content stream refers to.
  const layerNames = new Map<string, string>();
  try {
    const config = await doc.getOptionalContentConfig();
    // getOrder returns the layer tree as ids, which can nest when a PDF groups
    // its layers, so it is flattened before each id is looked up.
    const flatten = (nodes: unknown[], into: string[]) => {
      for (const node of nodes) {
        if (typeof node === "string") into.push(node);
        else if (Array.isArray(node)) flatten(node, into);
        else if (node && typeof node === "object" && "order" in node)
          flatten((node as { order: unknown[] }).order, into);
      }
      return into;
    };
    const ids = flatten(config?.getOrder() ?? [], []);
    for (const id of ids) {
      const group = config?.getGroup(id) as { name?: string } | null;
      layerNames.set(id, group?.name ?? id);
    }
  } catch {
    // A PDF without layers is perfectly normal.
  }

  const { OPS } = await import("pdfjs-dist");
  const operators = await page.getOperatorList();

  const paths: VectorPath[] = [];
  const skipped = { images: 0, text: 0, shading: 0 };
  let ctm: Matrix = IDENTITY;
  const ctmStack: Matrix[] = [];
  const layerStack: string[] = [];
  const markedStack: boolean[] = [];
  let order = 0;

  for (let i = 0; i < operators.fnArray.length; i++) {
    const fn = operators.fnArray[i];
    const args = operators.argsArray[i] as unknown[];

    switch (fn) {
      case OPS.save:
        ctmStack.push(ctm);
        break;
      case OPS.restore:
        ctm = ctmStack.pop() ?? IDENTITY;
        break;
      case OPS.transform:
        ctm = multiply(ctm, args as unknown as Matrix);
        break;

      case OPS.beginMarkedContentProps: {
        const [tag, properties] = args as [string, unknown];
        const id =
          typeof properties === "string"
            ? properties
            : (properties as { id?: string })?.id;
        const isLayer = tag === "OC" && typeof id === "string";
        markedStack.push(isLayer);
        if (isLayer) layerStack.push(layerNames.get(id!) ?? id!);
        break;
      }
      case OPS.beginMarkedContent:
        markedStack.push(false);
        break;
      case OPS.endMarkedContent:
        if (markedStack.pop()) layerStack.pop();
        break;

      case OPS.constructPath: {
        const [paintOp, data] = args as [number, unknown[]];
        // pdf.js hands the path back as a Float32Array inside a one-element
        // array, so Array.isArray says no to the thing that matters.
        const raw = Array.isArray(data) ? data[0] : null;
        const isNumericArray =
          Array.isArray(raw) || (ArrayBuffer.isView(raw) && !(raw instanceof DataView));
        if (!isNumericArray) break;
        const points = raw as ArrayLike<number>;

        const filled =
          paintOp === OPS.fill ||
          paintOp === OPS.eoFill ||
          paintOp === OPS.fillStroke ||
          paintOp === OPS.eoFillStroke ||
          paintOp === OPS.closeFillStroke ||
          paintOp === OPS.closeEOFillStroke;
        const stroked =
          paintOp === OPS.stroke ||
          paintOp === OPS.closeStroke ||
          paintOp === OPS.fillStroke ||
          paintOp === OPS.eoFillStroke ||
          paintOp === OPS.closeFillStroke ||
          paintOp === OPS.closeEOFillStroke;

        for (const subpath of decodePath(points, ctm)) {
          paths.push({
            ...subpath,
            filled,
            stroked,
            layer: layerStack.length ? layerStack[layerStack.length - 1] : null,
            bounds: boundsOf(subpath.start, subpath.segments),
            order: order++,
          });
        }
        break;
      }

      case OPS.paintImageXObject:
      case OPS.paintInlineImageXObject:
      case OPS.paintImageMaskXObject:
        skipped.images++;
        break;
      case OPS.showText:
      case OPS.showSpacedText:
        skipped.text++;
        break;
      case OPS.shadingFill:
        skipped.shading++;
        break;
    }
  }

  page.cleanup();

  return {
    width: viewport.width,
    height: viewport.height,
    paths,
    layers: [...new Set(paths.map((p) => p.layer).filter((l): l is string => !!l))],
    skipped,
  };
}
