"use client";

import { useEffect, useState } from "react";

interface Props {
  /** When the run started, from performance.now(). */
  startedAt: number;
  /** Seconds the engine was told to spend. */
  budgetSeconds: number;
}

/**
 * Shown over the sheet while the engine works.
 *
 * The bar is determinate because the effort budget is a real number the engine
 * was given, so it measures something rather than decorating a wait. It stops
 * short of full: the search returns a little after its budget, having a layout
 * to refine and validate, and a bar that sits at 100% while nothing happens is
 * worse than one that admits it is nearly there.
 */
export default function NestProgress({ startedAt, budgetSeconds }: Props) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      setElapsed((performance.now() - startedAt) / 1000);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [startedAt]);

  const fraction = Math.min(elapsed / Math.max(budgetSeconds, 0.1), 1);
  const percent = Math.min(fraction * 92, 92);
  const finishing = fraction >= 1;

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-neutral-950/70 backdrop-blur-[2px]">
      <div className="w-64 px-6">
        <div className="mb-2 flex items-baseline justify-between text-xs">
          <span className="text-neutral-200">
            {finishing ? "Finishing up" : "Nesting"}
          </span>
          <span className="tabular-nums text-neutral-500">
            {elapsed.toFixed(1)}s of {budgetSeconds}s
          </span>
        </div>

        <div className="relative h-1 overflow-hidden rounded-full bg-neutral-800">
          <div
            className="h-full rounded-full bg-cyan-400 transition-[width] duration-100 ease-linear"
            style={{ width: `${percent}%` }}
          />
          {finishing && (
            <div className="nest-sweep absolute inset-y-0 w-1/3 bg-cyan-300/60" />
          )}
        </div>

        <p className="mt-2 text-[11px] leading-snug text-neutral-500">
          {finishing
            ? "Checking nothing overlaps and nothing runs off the sheet."
            : "Trying orderings and angles, keeping the best."}
        </p>
      </div>
    </div>
  );
}
