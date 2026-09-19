"use client";

import { Choice, Section, Toggle } from "./Field";
import {
  ROTATION_STEPS,
  rotationCount,
  type NestingSettings,
} from "@/lib/settings";

interface Props {
  nesting: NestingSettings;
  onChange: (nesting: NestingSettings) => void;
  /** How many pieces the quantities add up to. */
  pieceCount: number;
  busy: boolean;
  onRun: () => void;
}

export default function NestSettingsPanel({
  nesting,
  onChange,
  pieceCount,
  busy,
  onRun,
}: Props) {
  const set = (patch: Partial<NestingSettings>) =>
    onChange({ ...nesting, ...patch });

  return (
    <Section title="Nesting">
      <Toggle
        label="Repeat to fill the sheet"
        checked={nesting.fillSheet}
        onChange={(v) => set({ fillSheet: v })}
        hint="Keep laying down the quantities below, in proportion, until nothing more fits."
      />

      <div className="h-px bg-neutral-800" />

      <Toggle
        label="Allow rotation"
        checked={nesting.allowRotation}
        onChange={(v) => set({ allowRotation: v })}
        hint="Off pins every piece upright, for artwork with a print direction."
      />

      {nesting.allowRotation && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-neutral-400">Rotation angle</span>
            <span className="text-xs tabular-nums text-neutral-300">
              {nesting.rotationStepDeg}° ({rotationCount(nesting.rotationStepDeg)} angles)
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={ROTATION_STEPS.length - 1}
            step={1}
            value={ROTATION_STEPS.indexOf(nesting.rotationStepDeg)}
            onChange={(e) =>
              set({ rotationStepDeg: ROTATION_STEPS[Number(e.target.value)] })
            }
            className="w-full accent-cyan-400"
          />
          <p className="text-xs text-neutral-600">
            Finer angles give the search more to try, and more to get through.
          </p>
        </div>
      )}

      <div className="h-px bg-neutral-800" />

      <Choice
        label="Effort"
        value={String(nesting.effortSeconds)}
        options={[
          { value: "2", label: "Fast" },
          { value: "10", label: "Balanced" },
          { value: "60", label: "Best" },
        ]}
        onChange={(v) => set({ effortSeconds: Number(v) })}
      />
      <p className="text-xs text-neutral-600">
        {nesting.effortSeconds} seconds of searching. The page will sit still for
        that long, because the engine runs on this thread.
      </p>

      <button
        onClick={onRun}
        disabled={busy || pieceCount === 0}
        className="w-full rounded-md bg-cyan-400 px-4 py-2 text-sm font-medium text-neutral-950 transition hover:bg-cyan-300 disabled:opacity-40"
      >
        {busy
          ? "Nesting…"
          : pieceCount === 0
            ? "Nothing to nest"
            : nesting.fillSheet
              ? "Fill the sheet"
              : `Nest ${pieceCount} piece${pieceCount === 1 ? "" : "s"}`}
      </button>

      {/*
        Nest-Pro offers three more controls that this engine does not have, and
        saying so is better than showing a switch that does nothing.
      */}
      <details className="text-xs text-neutral-600">
        <summary className="cursor-pointer hover:text-neutral-400">
          Not available yet
        </summary>
        <ul className="mt-2 space-y-1 pl-3">
          <li>
            <strong className="text-neutral-500">Rectangle mode.</strong> The
            engine detects near-rectangular shapes itself and switches to a
            faster path, so there is nothing to choose.
          </li>
          <li>
            <strong className="text-neutral-500">Rotate to minimise height.</strong>{" "}
            Not implemented. The search packs towards a corner instead.
          </li>
          <li>
            <strong className="text-neutral-500">Group overlapping objects.</strong>{" "}
            Always on. Overlapping paths in one design are merged into a single
            outline before nesting.
          </li>
        </ul>
      </details>
    </Section>
  );
}
