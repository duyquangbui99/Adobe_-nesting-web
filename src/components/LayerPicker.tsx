"use client";

import type { LayerSummary } from "@/lib/pdf/geometry";

interface Props {
  layers: LayerSummary[];
  cutLayer: string | null;
  onChoose: (layer: string | null) => void;
  onHover: (layer: string | null) => void;
}

export default function LayerPicker({ layers, cutLayer, onChoose, onHover }: Props) {
  return (
    <div>
      <p className="mb-3 text-xs text-neutral-500">
        Which layer holds the cut contours. Hover a row to isolate it on the
        sheet, so you can see what has been taken for a cut line before nesting
        anything.
      </p>
      <ul className="space-y-2">
        {layers.map((layer) => {
          const chosen = layer.name === cutLayer;
          return (
            <li key={layer.label}>
              <button
                onClick={() => onChoose(layer.name)}
                onMouseEnter={() => onHover(layer.name)}
                onMouseLeave={() => onHover(null)}
                className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                  chosen
                    ? "border-cyan-400/60 bg-cyan-400/10"
                    : "border-neutral-800 bg-neutral-900/60 hover:border-neutral-700"
                }`}
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-medium text-neutral-100">
                    {layer.label}
                  </span>
                  <span className={chosen ? "text-xs text-cyan-300" : "text-xs text-neutral-500"}>
                    {layer.cutLike} cut
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-neutral-500">
                  {layer.paths} paths, {layer.closed} closed
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
