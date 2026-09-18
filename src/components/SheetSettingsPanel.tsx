"use client";

import { useState } from "react";

import { Choice, NumberField, Section } from "./Field";
import {
  deletePreset,
  fromUnit,
  loadPresets,
  savePreset,
  toUnit,
  type NestingSettings,
  type Preset,
  type SheetSettings,
} from "@/lib/settings";

interface Props {
  sheet: SheetSettings;
  nesting: NestingSettings;
  onChange: (sheet: SheetSettings) => void;
  onLoadPreset: (preset: Preset) => void;
  /** Filled in from the PDF, so a sheet can be matched to the file it came from. */
  pageSizeMm: { width: number; height: number } | null;
}

export default function SheetSettingsPanel({
  sheet,
  nesting,
  onChange,
  onLoadPreset,
  pageSizeMm,
}: Props) {
  // Read once on mount rather than during render: localStorage does not exist
  // on the server, and setting state straight from an effect cascades renders.
  const [presets, setPresets] = useState<Preset[]>(() =>
    typeof window === "undefined" ? [] : loadPresets()
  );
  const [name, setName] = useState("");

  const set = (patch: Partial<SheetSettings>) => onChange({ ...sheet, ...patch });
  const unit = sheet.unit;
  const suffix = unit === "inch" ? "in" : "mm";
  const step = unit === "inch" ? 0.125 : 1;

  // Editing in the chosen unit while storing millimetres, so switching units
  // never nudges a value.
  const field = (
    label: string,
    key: keyof SheetSettings & `${string}Mm`,
  ) => (
    <NumberField
      label={label}
      value={toUnit(sheet[key] as number, unit)}
      suffix={suffix}
      step={step}
      onChange={(v) => set({ [key]: fromUnit(v, unit) } as Partial<SheetSettings>)}
    />
  );

  return (
    <Section title="Sheet">
      <div className="flex items-center gap-2">
        <select
          value=""
          onChange={(e) => {
            const found = presets.find((p) => p.name === e.target.value);
            if (found) {
              onLoadPreset(found);
              setName(found.name);
            }
          }}
          className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-200"
        >
          <option value="">{presets.length ? "Load a preset…" : "No presets yet"}</option>
          {presets.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
        {name && presets.some((p) => p.name === name) && (
          <button
            onClick={() => setPresets(deletePreset(name))}
            className="text-xs text-neutral-500 hover:text-rose-400"
          >
            Delete
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name this setup"
          className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-200 placeholder:text-neutral-600"
        />
        <button
          disabled={!name.trim()}
          onClick={() => setPresets(savePreset({ name: name.trim(), sheet, nesting }))}
          className="rounded-md border border-neutral-700 px-2.5 py-1 text-xs text-neutral-300 hover:border-neutral-500 disabled:opacity-40"
        >
          Save
        </button>
      </div>

      <div className="h-px bg-neutral-800" />

      <Choice
        label="Unit"
        value={unit}
        options={[
          { value: "mm", label: "mm" },
          { value: "inch", label: "inch" },
        ]}
        onChange={(v) => set({ unit: v })}
      />

      {field("Area width", "widthMm")}
      {field("Area height", "heightMm")}

      {pageSizeMm && (
        <button
          onClick={() =>
            set({ widthMm: pageSizeMm.width, heightMm: pageSizeMm.height })
          }
          className="w-full rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-400 hover:border-neutral-500 hover:text-neutral-200"
        >
          Match the file: {pageSizeMm.width.toFixed(0)} × {pageSizeMm.height.toFixed(0)} mm
        </button>
      )}

      <div className="h-px bg-neutral-800" />

      {field("Margin left", "marginLeftMm")}
      {field("Margin right", "marginRightMm")}
      {field("Margin top", "marginTopMm")}
      {field("Margin bottom", "marginBottomMm")}

      <div className="h-px bg-neutral-800" />

      {field("Minimum spacing", "spacingMm")}

      <Choice
        label="Alignment"
        value={sheet.alignment}
        options={[
          { value: "top", label: "Top" },
          { value: "bottom", label: "Bottom" },
        ]}
        onChange={(v) => set({ alignment: v })}
      />
      <Choice
        label="Direction"
        value={sheet.direction}
        options={[
          { value: "leftToRight", label: "L → R" },
          { value: "rightToLeft", label: "R → L" },
        ]}
        onChange={(v) => set({ direction: v })}
      />
    </Section>
  );
}
