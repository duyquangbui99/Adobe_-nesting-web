"use client";

import { useEffect, useMemo, useRef } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

import type { PageGeometry } from "@/lib/pdf/extract";
import { renderPage } from "@/lib/pdf/load";
import { looksLikeCutLine, toSvgPath } from "@/lib/pdf/geometry";

interface Props {
  doc: PDFDocumentProxy;
  page: PageGeometry;
  cutLayer: string | null;
  highlight: string | null;
  scale: number;
}

export default function SheetView({ doc, page, cutLayer, highlight, scale }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    renderPage(doc, 1, canvas, scale).catch(() => {});
    return () => {
      cancelled = true;
      void cancelled;
    };
  }, [doc, scale]);

  const overlay = useMemo(() => {
    return page.paths.map((path, index) => {
      const isCut = path.layer === cutLayer && looksLikeCutLine(path);
      const dimmed = highlight !== null && path.layer !== highlight;
      return {
        key: index,
        d: toSvgPath(path),
        stroke: isCut ? "#22d3ee" : "#f472b6",
        width: isCut ? 1.6 : 0.6,
        opacity: dimmed ? 0.08 : isCut ? 1 : 0.45,
      };
    });
  }, [page, cutLayer, highlight]);

  return (
    <div className="relative inline-block rounded-lg bg-white shadow-2xl">
      <canvas ref={canvasRef} className="block rounded-lg" />
      {/*
        PDF coordinates put the origin at the bottom left and count upwards;
        the browser counts down. One flip on the group puts every extracted
        path exactly over the pixels pdf.js drew.
      */}
      <svg
        className="pointer-events-none absolute inset-0"
        width={page.width * scale}
        height={page.height * scale}
        viewBox={`0 0 ${page.width} ${page.height}`}
      >
        <g transform={`translate(0, ${page.height}) scale(1, -1)`}>
          {overlay.map((path) => (
            <path
              key={path.key}
              d={path.d}
              fill="none"
              stroke={path.stroke}
              strokeWidth={path.width}
              opacity={path.opacity}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
