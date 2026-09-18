"use client";

import { useMemo } from "react";

import type { VectorPath } from "@/lib/pdf/extract";
import { toSvgPath } from "@/lib/pdf/geometry";
import type { NestResult } from "@/lib/engine";
import type { SheetSettings } from "@/lib/settings";

const MM_TO_PT = 72 / 25.4;

interface Props {
  result: NestResult;
  /** Engine design index to the path it was built from. */
  pathForDesign: Map<number, VectorPath>;
  sheet: SheetSettings;
  /** Pixels per PDF point. */
  scale: number;
}

export default function LayoutView({ result, pathForDesign, sheet, scale }: Props) {
  const widthPt = sheet.widthMm * MM_TO_PT;
  const heightPt = sheet.heightMm * MM_TO_PT;

  const placed = useMemo(
    () =>
      result.placements
        .map((placement, index) => {
          const path = pathForDesign.get(placement.designIndex);
          if (!path) return null;
          return {
            key: index,
            d: toSvgPath(path),
            // The engine works in millimetres from the same origin the page
            // uses, so a placement is a rotation about that origin followed by
            // a move. SVG applies the rightmost transform first, which is the
            // order wanted here.
            transform: `translate(${placement.x * MM_TO_PT} ${
              placement.y * MM_TO_PT
            }) rotate(${placement.rotationDeg})`,
            sheetIndex: placement.sheetIndex,
          };
        })
        .filter((p): p is NonNullable<typeof p> => p !== null),
    [result, pathForDesign]
  );

  const usable = {
    x: sheet.marginLeftMm * MM_TO_PT,
    y: sheet.marginBottomMm * MM_TO_PT,
    width: (sheet.widthMm - sheet.marginLeftMm - sheet.marginRightMm) * MM_TO_PT,
    height: (sheet.heightMm - sheet.marginTopMm - sheet.marginBottomMm) * MM_TO_PT,
  };

  return (
    <svg
      width={widthPt * scale}
      height={heightPt * scale}
      viewBox={`0 0 ${widthPt} ${heightPt}`}
      className="rounded-lg bg-white shadow-2xl"
    >
      {/* PDF counts its vertical axis upwards; the browser counts down. */}
      <g transform={`translate(0, ${heightPt}) scale(1, -1)`}>
        <rect
          x={usable.x}
          y={usable.y}
          width={usable.width}
          height={usable.height}
          fill="none"
          stroke="#cbd5e1"
          strokeWidth={1}
          strokeDasharray="6 4"
          vectorEffect="non-scaling-stroke"
        />
        {placed.map((piece) => (
          <path
            key={piece.key}
            d={piece.d}
            transform={piece.transform}
            fill="#bfdbfe"
            fillOpacity={0.75}
            stroke="#2563eb"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
    </svg>
  );
}
