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
  designs: { id: string; usable: boolean; vertices?: number; areaMm2?: number }[];
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
  marginMm: number;
}

export interface NestSettings {
  gapMm: number;
  rotationStepDeg: number;
  timeBudgetSeconds: number;
  maxSheets: number;
}

interface EngineModule {
  ccall: (
    name: string,
    returnType: string | null,
    argTypes: string[],
    args: unknown[]
  ) => never | number | string;
  UTF8ToString: (pointer: number) => string;
}

let enginePromise: Promise<EngineModule> | null = null;

async function engine(): Promise<EngineModule> {
  if (!enginePromise) {
    enginePromise = import("./nest-engine.js").then((mod) =>
      (mod.default as (options: object) => Promise<EngineModule>)({
        // The .wasm is served from public/ rather than resolved next to the
        // glue, because bundlers move the glue and the .wasm apart.
        locateFile: (path: string) => (path.endsWith(".wasm") ? "/nest-engine.wasm" : path),
      })
    );
  }
  return enginePromise;
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
  const mod = await engine();

  const request = {
    sheet: {
      width: sheet.widthMm,
      height: sheet.heightMm,
      marginLeft: sheet.marginMm,
      marginRight: sheet.marginMm,
      marginTop: sheet.marginMm,
      marginBottom: sheet.marginMm,
    },
    gap: settings.gapMm,
    rotationStepDeg: settings.rotationStepDeg,
    maxSheets: settings.maxSheets,
    timeBudgetSeconds: settings.timeBudgetSeconds,
    designs: designs.map((d) => ({
      id: d.id,
      quantity: d.quantity,
      rotation: "free",
      paths: d.paths.map(pathToEngine),
    })),
  };

  const pointer = mod.ccall("nest_run", "number", ["string"], [
    JSON.stringify(request),
  ]) as number;
  const text = mod.UTF8ToString(pointer);
  mod.ccall("nest_free", null, ["number"], [pointer]);
  return JSON.parse(text) as NestResult;
}
