"use client";

import type { VectorPath } from "@/lib/pdf/extract";
import { toSvgPath } from "@/lib/pdf/geometry";
import type { PagePreview } from "@/lib/pdf/preview";

/**
 * The source page shown through one cut contour, which is what a sticker is.
 *
 * The outer group flips the vertical axis so the paths, which are in PDF
 * coordinates counting upwards, land where they belong. The image then carries
 * the same flip again: two flips cancel, so it draws the right way up while the
 * clip still works in the space the path was measured in.
 */
export function StickerClip({
  id,
  design,
  preview,
}: {
  id: string;
  design: VectorPath;
  preview: PagePreview;
}) {
  return (
    <>
      <clipPath id={id} clipPathUnits="userSpaceOnUse">
        <path d={toSvgPath(design)} />
      </clipPath>
      <g id={`${id}-art`} clipPath={`url(#${id})`}>
        <g transform={`translate(0, ${preview.heightPt}) scale(1, -1)`}>
          <image
            href={preview.url}
            x={0}
            y={0}
            width={preview.widthPt}
            height={preview.heightPt}
          />
        </g>
      </g>
    </>
  );
}
