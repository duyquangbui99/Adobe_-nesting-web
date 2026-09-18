// Browser-side pdf.js setup. Kept apart from the extractor so the extractor
// stays runnable in node, where none of this applies.

import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";

let configured = false;

function configure() {
  if (configured) return;
  // The worker is copied into public/ by an npm script rather than bundled.
  // Next.js will happily bundle it, but then every page load drags two
  // megabytes of PDF parser through the app bundle.
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";
  configured = true;
}

export async function loadPdf(file: File): Promise<PDFDocumentProxy> {
  configure();
  const bytes = new Uint8Array(await file.arrayBuffer());
  return pdfjs.getDocument({ data: bytes }).promise;
}

/** Renders a page to a canvas at the given scale, for the backdrop. */
export async function renderPage(
  doc: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale: number
) {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const context = canvas.getContext("2d");
  if (!context) return;

  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);

  await page.render({ canvas, canvasContext: context, viewport }).promise;
  page.cleanup();
}
