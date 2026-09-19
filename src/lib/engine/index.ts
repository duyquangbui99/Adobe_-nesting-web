// The nesting engine, compiled from the same C++ the Illustrator plugin uses.
//
// The boundary is a JSON string in each direction. That keeps the engine a
// plain C++ library with no idea it is being called from a browser, which is
// the same rule that let it be called from an Adobe plugin.

import type { VectorPath } from "@/lib/pdf/extract";
import { PT_TO_MM } from "@/lib/pdf/geometry";

export interface NestPlacement {
  designIndex: number;
  instanceIndex: number;
  sheetIndex: number;
  /** Millimetres, in the same frame the paths were handed over in. */
  x: number;
  y: number;
  rotationDeg: number;
}

export interface NestViolation {
  kind: string;
  designIndex: number;
  instanceIndex: number;
  magnitudeMm: number;
  message: string;
}

export interface NestResult {
  ok: boolean;
  error?: string;
  placements: NestPlacement[];
  unplaced: number;
  sheetCount: number;
  utilization: number;
  generations: number;
  evaluations: number;
  elapsedSeconds: number;
  fromLattice: boolean;
  designs: {
    id: string;
    usable: boolean;
    /** Index into the engine's own design list, or -1 when it was dropped. */
    designIndex: number;
    vertices?: number;
    searchVertices?: number;
    searchToleranceMm?: number;
    areaMm2?: number;
  }[];
  validation: {
    ok: boolean;
    placed: number;
    requested: number;
    worstPenetrationMm: number;
    worstOverrunMm: number;
    violations: NestViolation[];
  };
}

export interface SheetSpec {
  widthMm: number;
  heightMm: number;
  marginLeftMm: number;
  marginRightMm: number;
  marginTopMm: number;
  marginBottomMm: number;
}

export interface NestSettings {
  gapMm: number;
  rotationStepDeg: number;
  timeBudgetSeconds: number;
  maxSheets: number;
  /** Which corner to pack towards. */
  direction: "bottomLeft" | "topLeft" | "bottomRight" | "topRight";
  /** Off pins every piece upright, for artwork with a print direction. */
  allowRotation: boolean;
}

import type { NestWorkerResponse } from "./worker";

// One worker for the session. Starting it costs a WebAssembly compile, which is
// worth paying once rather than on every press of the button.
let worker: Worker | null = null;
let nextRequestId = 1;

function ensureWorker(): Worker {
  if (!worker)
    worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
  return worker;
}

function callEngine(payload: string): Promise<string> {
  const instance = ensureWorker();
  const id = nextRequestId++;

  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent<NestWorkerResponse>) => {
      // Replies are matched by id: a run the user abandoned by changing a
      // setting and pressing again must not resolve the one they are waiting on.
      if (event.data.id !== id) return;
      instance.removeEventListener("message", onMessage);
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.text!);
    };
    instance.addEventListener("message", onMessage);
    instance.postMessage({ id, payload });
  });
}

/** One extracted path, converted from PDF points into engine millimetres. */
function pathToEngine(path: VectorPath) {
  const p = (x: number, y: number) => [x * PT_TO_MM, y * PT_TO_MM];
  return {
    start: p(path.start.x, path.start.y),
    closed: path.closed,
    segments: path.segments.map((s) => [
      ...p(s.c1.x, s.c1.y),
      ...p(s.c2.x, s.c2.y),
      ...p(s.end.x, s.end.y),
    ]),
  };
}

export async function nest(
  designs: { id: string; paths: VectorPath[]; quantity: number }[],
  sheet: SheetSpec,
  settings: NestSettings
): Promise<NestResult> {
  const request = {
    sheet: {
      width: sheet.widthMm,
      height: sheet.heightMm,
      marginLeft: sheet.marginLeftMm,
      marginRight: sheet.marginRightMm,
      marginTop: sheet.marginTopMm,
      marginBottom: sheet.marginBottomMm,
    },
    gap: settings.gapMm,
    rotationStepDeg: settings.rotationStepDeg,
    maxSheets: settings.maxSheets,
    direction: settings.direction,
    timeBudgetSeconds: settings.timeBudgetSeconds,
    designs: designs.map((d) => ({
      id: d.id,
      quantity: d.quantity,
      rotation: settings.allowRotation ? "free" : "fixed",
      paths: d.paths.map(pathToEngine),
    })),
  };

  return JSON.parse(await callEngine(JSON.stringify(request))) as NestResult;
}
