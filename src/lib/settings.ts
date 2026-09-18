// The two settings panels, modelled on what a shop already knows from
// AI Nest-Pro, but only exposing controls that genuinely reach the engine.
//
// Everything here is millimetres. Inches exist only for display, because a
// second internal unit is a second source of rounding errors.

export type Unit = "mm" | "inch";
export type Alignment = "top" | "bottom";
export type Direction = "leftToRight" | "rightToLeft";
export type EngineDirection = "bottomLeft" | "topLeft" | "bottomRight" | "topRight";

export interface SheetSettings {
  unit: Unit;
  widthMm: number;
  heightMm: number;
  marginLeftMm: number;
  marginRightMm: number;
  marginTopMm: number;
  marginBottomMm: number;
  /** Minimum clear distance between two placed pieces. */
  spacingMm: number;
  alignment: Alignment;
  direction: Direction;
}

export interface NestingSettings {
  /** Fill the sheet with as many copies as fit, ignoring the quantity. */
  fillSheet: boolean;
  quantity: number;
  allowRotation: boolean;
  /** Degrees between the angles the search may try. */
  rotationStepDeg: number;
  /** Seconds of searching. The spec's presets are 2, 10 and 60. */
  effortSeconds: number;
}

export const MM_PER_INCH = 25.4;

export const defaultSheet: SheetSettings = {
  unit: "mm",
  widthMm: 860,
  heightMm: 1260,
  marginLeftMm: 15,
  marginRightMm: 15,
  marginTopMm: 15,
  marginBottomMm: 15,
  spacingMm: 5,
  alignment: "top",
  direction: "rightToLeft",
};

export const defaultNesting: NestingSettings = {
  fillSheet: false,
  quantity: 1,
  allowRotation: true,
  rotationStepDeg: 10,
  effortSeconds: 2,
};

/** Alignment and direction together name one corner to pack towards. */
export function toEngineDirection(
  alignment: Alignment,
  direction: Direction
): EngineDirection {
  const top = alignment === "top";
  const left = direction === "leftToRight";
  if (top) return left ? "topLeft" : "topRight";
  return left ? "bottomLeft" : "bottomRight";
}

export function fromUnit(value: number, unit: Unit): number {
  return unit === "inch" ? value * MM_PER_INCH : value;
}

export function toUnit(mm: number, unit: Unit): number {
  const value = unit === "inch" ? mm / MM_PER_INCH : mm;
  // Two decimals in millimetres is a hundredth of a millimetre, finer than any
  // cutter; three in inches is about the same.
  const places = unit === "inch" ? 3 : 2;
  return Number(value.toFixed(places));
}

/** How many angles a rotation step allows, which is what Nest-Pro shows. */
export function rotationCount(stepDeg: number): number {
  return stepDeg > 0 ? Math.round(360 / stepDeg) : 1;
}

export const ROTATION_STEPS = [90, 45, 30, 15, 10, 5, 2, 1];

// Presets live in the browser. A shop nests the same sheet sizes every day and
// should not retype 860 by 1260 each morning.
const STORE = "stickernest.presets.v1";

export interface Preset {
  name: string;
  sheet: SheetSettings;
  nesting: NestingSettings;
}

export function loadPresets(): Preset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as Preset[]) : [];
  } catch {
    return [];
  }
}

export function savePreset(preset: Preset): Preset[] {
  const kept = loadPresets().filter((p) => p.name !== preset.name);
  const all = [...kept, preset].sort((a, b) => a.name.localeCompare(b.name));
  try {
    window.localStorage.setItem(STORE, JSON.stringify(all));
  } catch {
    // A browser refusing storage is not worth failing a nest over.
  }
  return all;
}

export function deletePreset(name: string): Preset[] {
  const all = loadPresets().filter((p) => p.name !== name);
  try {
    window.localStorage.setItem(STORE, JSON.stringify(all));
  } catch {
    // As above.
  }
  return all;
}
