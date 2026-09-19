// Finding the registration marks a cutter aligns the sheet by.
//
// They cannot be identified by layer name. The sheet this was built against
// keeps them on a layer called "Layer 1", and only the group inside carries a
// telling name. What does identify them is geometry: a small filled shape
// repeated at each corner at the same inset, which nothing else on a sticker
// sheet looks like.

import type { PageGeometry, VectorPath } from "./extract";
import { PT_TO_MM } from "./geometry";

export interface RegistrationMarks {
  /** One of the marks, to be redrawn at each corner of the new sheet. */
  shape: VectorPath;
  sizeMm: number;
  /** Distance from the sheet edge to the mark's centre. */
  insetXMm: number;
  insetYMm: number;
  found: number;
}

/** Largest dimension of a path, in millimetres. */
function extentMm(path: VectorPath): number {
  return (
    Math.max(path.bounds.maxX - path.bounds.minX, path.bounds.maxY - path.bounds.minY) *
    PT_TO_MM
  );
}

function centre(path: VectorPath) {
  return {
    x: (path.bounds.minX + path.bounds.maxX) / 2,
    y: (path.bounds.minY + path.bounds.maxY) / 2,
  };
}

export function findRegistrationMarks(page: PageGeometry): RegistrationMarks | null {
  // A mark is small, solid, and sits in from a corner. Fifteen millimetres is
  // generous: the ones seen in practice are five.
  const candidates = page.paths.filter((p) => p.filled && extentMm(p) <= 15);
  if (candidates.length < 3) return null;

  // Group by size and by how far in from the nearest corner they sit. A real
  // mark set agrees on both; artwork that happens to be small does not.
  const groups = new Map<string, VectorPath[]>();
  for (const path of candidates) {
    const c = centre(path);
    const insetX = Math.min(c.x, page.width - c.x) * PT_TO_MM;
    const insetY = Math.min(c.y, page.height - c.y) * PT_TO_MM;
    // Rounded to the millimetre, so marks that differ only by rounding in the
    // source still group together.
    const key = `${extentMm(path).toFixed(1)}:${insetX.toFixed(0)}:${insetY.toFixed(0)}`;
    groups.set(key, [...(groups.get(key) ?? []), path]);
  }

  const best = [...groups.values()]
    .filter((group) => group.length >= 3)
    // Marks sit further out than anything else that might tie; prefer the
    // smallest inset among sets of the same size.
    .sort((a, b) => b.length - a.length)[0];
  if (!best) return null;

  const shape = best[0];
  const c = centre(shape);
  return {
    shape,
    sizeMm: extentMm(shape),
    insetXMm: Math.min(c.x, page.width - c.x) * PT_TO_MM,
    insetYMm: Math.min(c.y, page.height - c.y) * PT_TO_MM,
    found: best.length,
  };
}
