// A content stream, split into operations, each one remembering the bytes it
// came from.
//
// Keeping the byte range is the point. Anything this file's callers decide to
// keep is re-emitted by copying the original bytes back out, so no operand is
// ever reformatted, no string re-escaped and no precision lost. The parser only
// has to understand enough to find where each operation begins and ends, and to
// read the handful of operands that describe geometry.

/** Operand values we care about. Anything else is kept as a raw byte range. */
export type Operand = number | { name: string } | { raw: true };

export interface Operation {
  operator: string;
  operands: Operand[];
  /** Byte range covering the operands and the operator together. */
  start: number;
  end: number;
}

const SPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITER = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

const isSpace = (b: number) => SPACE.has(b);
const isRegular = (b: number) => !isSpace(b) && !DELIMITER.has(b);

function decodeName(bytes: Uint8Array, from: number, to: number): string {
  let out = "";
  for (let i = from; i < to; i++) {
    if (bytes[i] === 0x23 && i + 2 < to) {
      out += String.fromCharCode(parseInt(String.fromCharCode(bytes[i + 1], bytes[i + 2]), 16));
      i += 2;
    } else out += String.fromCharCode(bytes[i]);
  }
  return out;
}

/**
 * Walks a content stream and returns its operations in order.
 *
 * Malformed input ends the walk rather than throwing: a caller that gets back
 * fewer operations than the stream really held will keep the whole stream,
 * which is the safe direction.
 */
export function parseOperations(bytes: Uint8Array): Operation[] {
  const operations: Operation[] = [];
  let operands: Operand[] = [];
  let operandStart = -1;
  let i = 0;

  const note = (value: Operand, from: number) => {
    if (operandStart < 0) operandStart = from;
    operands.push(value);
  };

  while (i < bytes.length) {
    const byte = bytes[i];

    if (isSpace(byte)) {
      i++;
      continue;
    }

    // Comment, to end of line.
    if (byte === 0x25) {
      while (i < bytes.length && bytes[i] !== 0x0a && bytes[i] !== 0x0d) i++;
      continue;
    }

    // Literal string, with nested parens and backslash escapes.
    if (byte === 0x28) {
      const from = i++;
      let depth = 1;
      while (i < bytes.length && depth > 0) {
        if (bytes[i] === 0x5c) i += 2;
        else if (bytes[i] === 0x28) { depth++; i++; }
        else if (bytes[i] === 0x29) { depth--; i++; }
        else i++;
      }
      note({ raw: true }, from);
      continue;
    }

    // Dictionary or hex string.
    if (byte === 0x3c) {
      const from = i;
      if (bytes[i + 1] === 0x3c) {
        let depth = 0;
        while (i < bytes.length) {
          if (bytes[i] === 0x3c && bytes[i + 1] === 0x3c) { depth++; i += 2; }
          else if (bytes[i] === 0x3e && bytes[i + 1] === 0x3e) { depth--; i += 2; if (!depth) break; }
          else i++;
        }
      } else {
        while (i < bytes.length && bytes[i] !== 0x3e) i++;
        i++;
      }
      note({ raw: true }, from);
      continue;
    }

    // Array.
    if (byte === 0x5b) {
      const from = i;
      let depth = 0;
      while (i < bytes.length) {
        if (bytes[i] === 0x28) {           // a string inside can hold brackets
          i++;
          let d = 1;
          while (i < bytes.length && d > 0) {
            if (bytes[i] === 0x5c) i += 2;
            else if (bytes[i] === 0x28) { d++; i++; }
            else if (bytes[i] === 0x29) { d--; i++; }
            else i++;
          }
          continue;
        }
        if (bytes[i] === 0x5b) { depth++; i++; }
        else if (bytes[i] === 0x5d) { depth--; i++; if (!depth) break; }
        else i++;
      }
      note({ raw: true }, from);
      continue;
    }

    // Name.
    if (byte === 0x2f) {
      const from = i++;
      while (i < bytes.length && isRegular(bytes[i])) i++;
      note({ name: decodeName(bytes, from + 1, i) }, from);
      continue;
    }

    // Number, or an operator.
    const from = i;
    while (i < bytes.length && isRegular(bytes[i])) i++;
    if (i === from) { i++; continue; }  // a delimiter we do not handle
    const text = String.fromCharCode(...bytes.subarray(from, i));

    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)) {
      note(Number(text), from);
      continue;
    }

    // An operator closes the operation.
    const operation: Operation = {
      operator: text,
      operands,
      start: operandStart < 0 ? from : operandStart,
      end: i,
    };
    operands = [];
    operandStart = -1;

    // An inline image carries binary between ID and EI, which is not tokens.
    if (text === "BI") {
      let scan = i;
      while (scan < bytes.length - 1 && !(bytes[scan] === 0x49 && bytes[scan + 1] === 0x44)) scan++;
      scan += 3;  // ID plus the single whitespace byte that follows it
      while (scan < bytes.length - 1) {
        if (bytes[scan] === 0x45 && bytes[scan + 1] === 0x49 &&
            (scan + 2 >= bytes.length || isSpace(bytes[scan + 2])) && isSpace(bytes[scan - 1])) {
          scan += 2;
          break;
        }
        scan++;
      }
      operation.operator = "INLINE_IMAGE";
      operation.end = Math.min(scan, bytes.length);
      i = operation.end;
    }

    operations.push(operation);
  }

  return operations;
}
