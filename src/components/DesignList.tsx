"use client";

import { useMemo } from "react";

import type { VectorPath } from "@/lib/pdf/extract";
import { toSvgPath, PT_TO_MM } from "@/lib/pdf/geometry";

interface Props {
  designs: VectorPath[];
  quantities: number[];
  onChange: (quantities: number[]) => void;
  /** How many of each were actually placed, once a nest has run. */
  placedPerDesign: number[] | null;
}

export default function DesignList({
  designs,
  quantities,
  onChange,
  placedPerDesign,
}: Props) {
  const total = quantities.reduce((sum, n) => sum + n, 0);

  const setOne = (index: number, value: number) => {
    const next = [...quantities];
    next[index] = Math.max(0, Math.round(value));
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-neutral-500">
        <span>
          {designs.length} shape{designs.length === 1 ? "" : "s"}, {total} piece
          {total === 1 ? "" : "s"} requested
        </span>
        <span className="flex gap-2">
          {[1, 5, 10].map((n) => (
            <button
              key={n}
              onClick={() => onChange(designs.map(() => n))}
              className="rounded border border-neutral-700 px-1.5 py-0.5 hover:border-neutral-500 hover:text-neutral-300"
            >
              all {n}
            </button>
          ))}
        </span>
      </div>

      <ul className="space-y-1.5">
        {designs.map((design, index) => (
          <DesignRow
            key={index}
            design={design}
            quantity={quantities[index] ?? 0}
            placed={placedPerDesign?.[index] ?? null}
            onChange={(value) => setOne(index, value)}
          />
        ))}
      </ul>
    </div>
  );
}

function DesignRow({
  design,
  quantity,
  placed,
  onChange,
}: {
  design: VectorPath;
  quantity: number;
  placed: number | null;
  onChange: (value: number) => void;
}) {
  const { width, height } = useMemo(
    () => ({
      width: (design.bounds.maxX - design.bounds.minX) * PT_TO_MM,
      height: (design.bounds.maxY - design.bounds.minY) * PT_TO_MM,
    }),
    [design]
  );

  // The shape drawn to fit its own box, so the list reads as the stickers it
  // is rather than as a row of numbers.
  const box = design.bounds;
  const pad = Math.max(box.maxX - box.minX, box.maxY - box.minY) * 0.06;

  // Short of what was asked for is worth seeing without opening anything.
  const short = placed !== null && placed < quantity;

  return (
    <li className="flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900/60 px-2.5 py-2">
      <svg
        viewBox={`${box.minX - pad} ${box.minY - pad} ${
          box.maxX - box.minX + pad * 2
        } ${box.maxY - box.minY + pad * 2}`}
        className="h-9 w-9 shrink-0"
      >
        <g transform={`translate(0, ${box.minY + box.maxY}) scale(1, -1)`}>
          <path
            d={toSvgPath(design)}
            fill="#1e3a5f"
            stroke="#22d3ee"
            strokeWidth={Math.max(box.maxX - box.minX, box.maxY - box.minY) * 0.02}
          />
        </g>
      </svg>

      <div className="min-w-0 flex-1">
        <div className="text-xs tabular-nums text-neutral-300">
          {width.toFixed(0)} × {height.toFixed(0)} mm
        </div>
        {placed !== null && (
          <div className={`text-xs ${short ? "text-amber-400" : "text-neutral-600"}`}>
            {placed} placed
          </div>
        )}
      </div>

      <input
        type="number"
        min={0}
        value={quantity}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-16 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-right text-sm tabular-nums text-neutral-100 focus:border-cyan-400 focus:outline-none"
      />
    </li>
  );
}
