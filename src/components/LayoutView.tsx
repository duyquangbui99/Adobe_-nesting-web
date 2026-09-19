"use client";

import { useMemo } from "react";

import type { VectorPath } from "@/lib/pdf/extract";
import { toSvgPath } from "@/lib/pdf/geometry";
import type { PagePreview } from "@/lib/pdf/preview";
import type { NestResult } from "@/lib/engine";
import type { SheetSettings } from "@/lib/settings";
import { StickerClip } from "./StickerImage";

const MM_TO_PT = 72 / 25.4;

interface Props {
  result: NestResult;
  /** Engine design index to the cut contour it was built from. */
  pathForDesign: Map<number, VectorPath>;
  sheet: SheetSettings;
  /** The source page, so each sticker can be shown as its artwork. */
  preview: PagePreview | null;
  /** Pixels per PDF point. */
  scale: number;
}

export default function LayoutView({
  result,
  pathForDesign,
  sheet,
  preview,
  scale,
}: Props) {
  const widthPt = sheet.widthMm * MM_TO_PT;
  const heightPt = sheet.heightMm * MM_TO_PT;

  const designs = useMemo(
    () => [...pathForDesign.entries()].sort((a, b) => a[0] - b[0]),
    [pathForDesign]
  );

  const placed = useMemo(
    () =>
      result.placements
        .map((placement, index) => {
          const path = pathForDesign.get(placement.designIndex);
          if (!path) return null;
          return {
            key: index,
            designIndex: placement.designIndex,
            outline: toSvgPath(path),
            // The engine works in millimetres from the same origin the page
            // uses, so a placement is a rotation about that origin followed by
            // a move. SVG applies the rightmost transform first, which is the
            // order wanted here.
            transform: `translate(${placement.x * MM_TO_PT} ${
              placement.y * MM_TO_PT
            }) rotate(${placement.rotationDeg})`,
          };
        })
        .filter((piece): piece is NonNullable<typeof piece> => piece !== null),
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
      {/* One clipped copy of the page per design, referenced by every placement
          of it rather than repeated, so twenty copies of a sticker cost one
          decode and twenty references. */}
      {preview && (
        <defs>
          {designs.map(([designIndex, path]) => (
            <StickerClip
              key={designIndex}
              id={`design-${designIndex}`}
              design={path}
              preview={preview}
            />
          ))}
        </defs>
      )}

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
        {placed.map((piece, order) => (
          <g
            key={piece.key}
            transform={piece.transform}
            className="sticker-in"
            // Capped, or a sheet of two hundred would take half a minute to
            // finish appearing.
            style={{ animationDelay: `${Math.min(order * 18, 900)}ms` }}
          >
            {preview ? (
              <use href={`#design-${piece.designIndex}-art`} />
            ) : (
              <path d={piece.outline} fill="#bfdbfe" fillOpacity={0.75} />
            )}
            {/* The cut line, drawn over the artwork, because it is the thing
                being laid out and the thing a cutter will follow. */}
            <path
              d={piece.outline}
              fill="none"
              stroke="#e0218a"
              strokeWidth={0.75}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}
      </g>
    </svg>
  );
}
