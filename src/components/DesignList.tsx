"use client";

import { useMemo } from "react";

import type { VectorPath } from "@/lib/pdf/extract";
import { PT_TO_MM } from "@/lib/pdf/geometry";
import type { PagePreview } from "@/lib/pdf/preview";
import { StickerClip } from "./StickerImage";

interface Props {
  designs: VectorPath[];
  quantities: number[];
  onChange: (quantities: number[]) => void;
  /** How many of each were actually placed, once a nest has run. */
  placedPerDesign: number[] | null;
  /** The source page, so a row shows the sticker rather than its outline. */
  preview: PagePreview | null;
}

export default function DesignList({
  designs,
  quantities,
  onChange,
  placedPerDesign,
  preview,
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
            index={index}
            design={design}
            preview={preview}
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
  index,
  design,
  preview,
  quantity,
  placed,
  onChange,
}: {
  index: number;
  design: VectorPath;
  preview: PagePreview | null;
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
      {/* The sticker itself, which is the page seen through its cut contour.
          Drawing the outline alone made every name sticker an identical blob. */}
      <svg
        viewBox={`${box.minX - pad} ${box.minY - pad} ${
          box.maxX - box.minX + pad * 2
        } ${box.maxY - box.minY + pad * 2}`}
        className="h-11 w-11 shrink-0"
      >
        {preview && (
          <defs>
            <StickerClip id={`row-${index}`} design={design} preview={preview} />
          </defs>
        )}
        <g transform={`translate(0, ${box.minY + box.maxY}) scale(1, -1)`}>
          {preview ? (
            <use href={`#row-${index}-art`} />
          ) : (
            <path d={toSvgPathFallback(design)} fill="#1e3a5f" />
          )}
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
        // The spinners are too small to hit and too easy to hit by accident
        // while scrolling the list. Typing is the only sensible way to set a
        // quantity anyway.
        className="w-16 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-right text-sm tabular-nums text-neutral-100 [appearance:textfield] focus:border-cyan-400 focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
    </li>
  );
}

// Only reached before the page has finished rendering, when there is nothing to
// show the sticker with.
function toSvgPathFallback(design: VectorPath): string {
  const parts = [`M ${design.start.x} ${design.start.y}`];
  for (const s of design.segments)
    parts.push(`C ${s.c1.x} ${s.c1.y} ${s.c2.x} ${s.c2.y} ${s.end.x} ${s.end.y}`);
  return parts.join(" ") + " Z";
}
