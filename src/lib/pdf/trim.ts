// Cuts a page's content stream down to the part of it that can paint inside
// one sticker.
//
// Every sticker in an exported sheet is the whole source page drawn again and
// clipped to that sticker's cut contour. That is what keeps images, spot
// colours and overprint intact: nothing is reinterpreted. The cost is that
// Illustrator expands each copy on import, so a seven-design sheet arrives
// with every design repeated once per sticker, clipped out of sight but
// present, selectable and slow.
//
// This removes what the clip was hiding. The clip stays exactly where it was,
// which is the safety property the whole file rests on: dropping an operation
// that could not have painted inside the contour cannot change what the page
// looks like. So every bound here is deliberately generous, and anything that
// cannot be bounded at all is kept.

import { parseOperations, type Operation } from "./content";

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** a b c d e f, as PDF writes it. */
export type Matrix = [number, number, number, number, number, number];

export type XObjectInfo =
  | { kind: "image" }
  | { kind: "form"; bbox: Box; matrix: Matrix }
  | null;

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `m` applied first, then `n`. */
function concat(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

function apply(m: Matrix, x: number, y: number) {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

const empty = (): Box => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
const isEmpty = (b: Box) => b.minX > b.maxX || b.minY > b.maxY;

function extend(box: Box, x: number, y: number) {
  if (x < box.minX) box.minX = x;
  if (x > box.maxX) box.maxX = x;
  if (y < box.minY) box.minY = y;
  if (y > box.maxY) box.maxY = y;
}

function merge(into: Box, from: Box) {
  if (isEmpty(from)) return;
  extend(into, from.minX, from.minY);
  extend(into, from.maxX, from.maxY);
}

function intersection(a: Box, b: Box): Box {
  return {
    minX: Math.max(a.minX, b.minX),
    minY: Math.max(a.minY, b.minY),
    maxX: Math.min(a.maxX, b.maxX),
    maxY: Math.min(a.maxY, b.maxY),
  };
}

function overlaps(a: Box, b: Box): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

function grown(box: Box, by: number): Box {
  return { minX: box.minX - by, minY: box.minY - by, maxX: box.maxX + by, maxY: box.maxY + by };
}

/** The bounding box of a matrix applied to a box, which is not a box's image. */
function transformed(box: Box, m: Matrix): Box {
  const out = empty();
  for (const [x, y] of [
    [box.minX, box.minY],
    [box.maxX, box.minY],
    [box.minX, box.maxY],
    [box.maxX, box.maxY],
  ]) {
    const p = apply(m, x, y);
    extend(out, p.x, p.y);
  }
  return out;
}

// --- the q/Q tree ------------------------------------------------------------

interface Block {
  items: Item[];
  /** The `q` and `Q` themselves, absent at the root. */
  open: Operation | null;
  close: Operation | null;
}
type Item = { kind: "op"; op: Operation } | { kind: "block"; block: Block };

function buildTree(operations: Operation[]): Block {
  const root: Block = { items: [], open: null, close: null };
  const stack: Block[] = [root];

  for (const op of operations) {
    const here = stack[stack.length - 1];
    if (op.operator === "q") {
      const block: Block = { items: [], open: op, close: null };
      here.items.push({ kind: "block", block });
      stack.push(block);
    } else if (op.operator === "Q" && stack.length > 1) {
      stack.pop()!.close = op;
    } else {
      here.items.push({ kind: "op", op });
    }
  }
  return root;
}

// --- measuring ---------------------------------------------------------------

interface State {
  ctm: Matrix;
  lineWidth: number;
  /** Null means unbounded, which is how a page starts. */
  clip: Box | null;
}

interface Note {
  box: Box;
  /** Something in here could not be bounded, so it has to stay. */
  mustKeep: boolean;
}

const PAINTS = new Set(["S", "s", "f", "F", "f*", "B", "B*", "b", "b*"]);
const STROKES = new Set(["S", "s", "B", "B*", "b", "b*"]);
const SHOWS_TEXT = new Set(["Tj", "TJ", "'", '"']);

function numbers(op: Operation): number[] {
  return op.operands.filter((o): o is number => typeof o === "number");
}

function measure(
  block: Block,
  inherited: State,
  lookup: (name: string) => XObjectInfo,
  notes: Map<Block, Note>
): Note {
  const state: State = { ...inherited, ctm: [...inherited.ctm] as Matrix };
  const note: Note = { box: empty(), mustKeep: false };

  let path = empty();
  let pendingClip = false;

  // Anything painted is confined to the clip, so intersecting with it can only
  // shrink what has to be kept, and never hides something that would show.
  const contribute = (box: Box) => {
    if (isEmpty(box)) return;
    const effective = state.clip ? intersection(box, state.clip) : box;
    if (!isEmpty(effective)) merge(note.box, effective);
  };
  const unbounded = () => {
    if (state.clip) contribute(state.clip);
    else note.mustKeep = true;
  };

  for (const item of block.items) {
    if (item.kind === "block") {
      const child = measure(item.block, state, lookup, notes);
      notes.set(item.block, child);
      merge(note.box, child.box);
      if (child.mustKeep) note.mustKeep = true;
      continue;
    }

    const op = item.op;
    const n = numbers(op);

    switch (op.operator) {
      case "cm":
        if (n.length >= 6) state.ctm = concat(n.slice(0, 6) as Matrix, state.ctm);
        break;
      case "w":
        if (n.length >= 1) state.lineWidth = n[0];
        break;

      case "m":
      case "l":
        if (n.length >= 2) {
          const p = apply(state.ctm, n[0], n[1]);
          extend(path, p.x, p.y);
        }
        break;
      case "c":
      case "v":
      case "y":
        // Control points bound the curve, which is what generous means here.
        for (let i = 0; i + 1 < n.length; i += 2) {
          const p = apply(state.ctm, n[i], n[i + 1]);
          extend(path, p.x, p.y);
        }
        break;
      case "re":
        if (n.length >= 4)
          for (const [x, y] of [
            [n[0], n[1]],
            [n[0] + n[2], n[1]],
            [n[0], n[1] + n[3]],
            [n[0] + n[2], n[1] + n[3]],
          ]) {
            const p = apply(state.ctm, x, y);
            extend(path, p.x, p.y);
          }
        break;

      case "W":
      case "W*":
        pendingClip = true;
        break;

      case "n":
      case "S":
      case "s":
      case "f":
      case "F":
      case "f*":
      case "B":
      case "B*":
      case "b":
      case "b*": {
        if (PAINTS.has(op.operator) && !isEmpty(path)) {
          // A stroke paints either side of the path, and a miter reaches past
          // half the width, so this allows a whole width all round.
          const scale = Math.max(Math.hypot(state.ctm[0], state.ctm[1]),
                                 Math.hypot(state.ctm[2], state.ctm[3]));
          contribute(STROKES.has(op.operator)
            ? grown(path, Math.max(state.lineWidth, 0) * scale)
            : path);
        }
        if (pendingClip && !isEmpty(path))
          state.clip = state.clip ? intersection(state.clip, path) : { ...path };
        pendingClip = false;
        path = empty();
        break;
      }

      case "Do": {
        const name = op.operands.find((o): o is { name: string } =>
          typeof o === "object" && o !== null && "name" in o);
        const info = name ? lookup(name.name) : null;
        if (!info) note.mustKeep = true;
        else if (info.kind === "image")
          contribute(transformed({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, state.ctm));
        else contribute(transformed(info.bbox, concat(info.matrix, state.ctm)));
        break;
      }
      case "INLINE_IMAGE":
        contribute(transformed({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, state.ctm));
        break;

      case "sh":
        // A shading fills the clip, and without one it fills the page.
        unbounded();
        break;

      default:
        // Glyphs need font metrics to bound, which is more machinery than a
        // sticker sheet's handful of text runs is worth. The clip usually
        // bounds them anyway.
        if (SHOWS_TEXT.has(op.operator)) unbounded();
        break;
    }
  }

  return note;
}

// --- emitting ----------------------------------------------------------------

function emit(
  block: Block,
  source: Uint8Array,
  target: Box,
  notes: Map<Block, Note>,
  out: Uint8Array[],
  counts: { kept: number; dropped: number }
) {
  const NEWLINE = Uint8Array.of(0x0a);
  const push = (op: Operation) => {
    out.push(source.subarray(op.start, op.end));
    out.push(NEWLINE);
  };

  for (const item of block.items) {
    if (item.kind === "op") {
      push(item.op);
      continue;
    }
    const note = notes.get(item.block);
    const keep = !note || note.mustKeep || (!isEmpty(note.box) && overlaps(note.box, target));
    if (!keep) {
      counts.dropped++;
      continue;
    }
    counts.kept++;
    if (item.block.open) push(item.block.open);
    emit(item.block, source, target, notes, out, counts);
    if (item.block.close) push(item.block.close);
  }
}

export interface TrimResult {
  bytes: Uint8Array;
  /** Top-level-through-nested blocks kept and dropped. */
  kept: number;
  dropped: number;
}

/**
 * Returns `content` with every `q`/`Q` block that cannot paint inside `target`
 * removed. Operations outside any block, and every block that survives, are
 * copied back byte for byte.
 */
export function trimContent(
  content: Uint8Array,
  target: Box,
  lookup: (name: string) => XObjectInfo
): TrimResult {
  const tree = buildTree(parseOperations(content));
  const notes = new Map<Block, Note>();
  measure(tree, { ctm: IDENTITY, lineWidth: 1, clip: null }, lookup, notes);

  const pieces: Uint8Array[] = [];
  const counts = { kept: 0, dropped: 0 };
  emit(tree, content, target, notes, pieces, counts);

  let size = 0;
  for (const piece of pieces) size += piece.length;
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const piece of pieces) {
    bytes.set(piece, at);
    at += piece.length;
  }
  return { bytes, kept: counts.kept, dropped: counts.dropped };
}
