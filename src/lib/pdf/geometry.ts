// Turning extracted paths into something the page can draw and the engine can
// nest. Shared by both so they cannot disagree about what a design is.

import type { PageGeometry, VectorPath } from "./extract";

export const PT_TO_MM = 25.4 / 72;

/** An SVG path definition in PDF points, ready to overlay on the rendered page. */
export function toSvgPath(path: VectorPath): string {
  const parts = [`M ${path.start.x} ${path.start.y}`];
  for (const s of path.segments)
    parts.push(`C ${s.c1.x} ${s.c1.y} ${s.c2.x} ${s.c2.y} ${s.end.x} ${s.end.y}`);
  if (path.closed) parts.push("Z");
  return parts.join(" ");
}

export interface LayerSummary {
  name: string | null;
  label: string;
  paths: number;
  closed: number;
  cutLike: number;
  /** Total area of the bounding boxes of its cut-like paths, in mm². */
  cutAreaMm2: number;
}

/**
 * A closed path that is stroked but not filled is how a cut contour looks when
 * a shop marks it by layer rather than by a named spot colour, which is what a
 * real production sheet turned out to do.
 */
export function looksLikeCutLine(path: VectorPath): boolean {
  return path.closed && path.stroked && !path.filled;
}

export function summariseLayers(page: PageGeometry): LayerSummary[] {
  const names: (string | null)[] = [...page.layers];
  if (page.paths.some((p) => p.layer === null)) names.push(null);

  return names.map((name) => {
    const onLayer = page.paths.filter((p) => p.layer === name);
    const cutLike = onLayer.filter(looksLikeCutLine);
    const cutAreaMm2 = cutLike.reduce(
      (total, p) =>
        total +
        (p.bounds.maxX - p.bounds.minX) *
          PT_TO_MM *
          ((p.bounds.maxY - p.bounds.minY) * PT_TO_MM),
      0
    );
    return {
      name,
      label: name ?? "no layer",
      paths: onLayer.length,
      closed: onLayer.filter((p) => p.closed).length,
      cutLike: cutLike.length,
      cutAreaMm2,
    };
  });
}

/**
 * Whether a layer holds cut contours and nothing else.
 *
 * An export can only switch the source's cut layer off if this is true. One
 * real sheet keeps its cut lines on a layer of their own, and another draws
 * them on the same layer as half the artwork; switching the second off takes
 * the artwork with it.
 */
export function holdsOnlyCutLines(summary: LayerSummary): boolean {
  return summary.paths > 0 && summary.cutLike === summary.paths;
}

/** The layer that most looks like it holds the cut contours. */
export function guessCutLayer(summaries: LayerSummary[]): string | null {
  const candidates = summaries.filter((s) => s.cutLike > 0);
  if (!candidates.length) return null;
  // Not simply the most cut-like paths: artwork layers are full of small
  // stroked shapes. The one whose cut-like paths cover the most area is the
  // one holding sticker-sized outlines.
  return candidates.reduce((best, s) => (s.cutAreaMm2 > best.cutAreaMm2 ? s : best))
    .name;
}
