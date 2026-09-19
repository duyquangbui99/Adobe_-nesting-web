// Renders the source page once to an image the previews can clip.
//
// A sticker is its cut contour with whatever the page draws inside it, so the
// only honest way to show one is to show the page through that shape. The
// alternative, drawing the extracted paths, throws away every raster image on
// the sheet and every fill the extractor does not model, which is most of what
// makes a sticker look like itself.

import type { PDFDocumentProxy } from "pdfjs-dist";

/** Longest edge of the rendered image, in pixels. */
const MAX_EDGE = 1800;

export interface PagePreview {
  /** Object URL of the rendered page. Revoke it when done. */
  url: string;
  /** Page size in PDF points, which is the space the paths live in. */
  widthPt: number;
  heightPt: number;
}

export async function renderPagePreview(
  doc: PDFDocumentProxy,
  pageNumber = 1
): Promise<PagePreview> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });

  // Enough to look sharp when a sticker is shown at a few centimetres, without
  // decoding a hundred megapixels for a sheet that is mostly white.
  const scale = Math.min(MAX_EDGE / Math.max(base.width, base.height), 4);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d context");

  await page.render({ canvas, canvasContext: context, viewport }).promise;
  page.cleanup();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png")
  );
  if (!blob) throw new Error("could not read the rendered page");

  return {
    // An object URL rather than a data URL: twenty-two copies of a data URL is
    // megabytes of markup, where an object URL is a handle the browser decodes
    // once however many times it is referenced.
    url: URL.createObjectURL(blob),
    widthPt: base.width,
    heightPt: base.height,
  };
}
