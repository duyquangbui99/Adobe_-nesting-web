"use client";

import { useCallback, useMemo, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

import DesignList from "@/components/DesignList";
import NestSettingsPanel from "@/components/NestSettingsPanel";
import SheetSettingsPanel from "@/components/SheetSettingsPanel";
import LayoutView from "@/components/LayoutView";
import SheetView from "@/components/SheetView";
import { nest, type NestResult } from "@/lib/engine";
import { exportNestedPdf } from "@/lib/pdf/export";
import {
  defaultNesting,
  defaultSheet,
  toEngineDirection,
  type NestingSettings,
  type Preset,
  type SheetSettings,
} from "@/lib/settings";
import { extractPageGeometry, type PageGeometry } from "@/lib/pdf/extract";
import { loadPdf } from "@/lib/pdf/load";
import { Section } from "@/components/Field";
import {
  guessCutLayer,
  looksLikeCutLine,
  summariseLayers,
  PT_TO_MM,
  type LayerSummary,
} from "@/lib/pdf/geometry";

type State =
  | { status: "empty" }
  | { status: "reading"; name: string }
  | { status: "failed"; message: string }
  | {
      status: "ready";
      name: string;
      doc: PDFDocumentProxy;
      /** Kept for export, which re-places the original bytes rather than
          redrawing anything. pdf.js detaches what it is given, so this is a
          copy. */
      bytes: Uint8Array;
      page: PageGeometry;
      layers: LayerSummary[];
    };

export default function Home() {
  const [state, setState] = useState<State>({ status: "empty" });
  const [cutLayer, setCutLayer] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [sheet, setSheet] = useState<SheetSettings>(defaultSheet);
  const [nestOptions, setNestOptions] = useState<NestingSettings>(defaultNesting);
  const [nesting, setNesting] = useState(false);
  const [result, setResult] = useState<NestResult | null>(null);
  // Which engine design each placement came from, so the layout can be drawn
  // with the shape the piece actually is.
  const [pathForDesign, setPathForDesign] = useState(
    new Map<number, import("@/lib/pdf/extract").VectorPath>()
  );
  // A result stops matching the controls the moment they move. Saying so beats
  // showing numbers that quietly describe a different request.
  const [stale, setStale] = useState(false);
  const [view, setView] = useState<"source" | "layout">("source");
  const [saving, setSaving] = useState(false);
  // One quantity per cut contour on the chosen layer, which is how an order
  // actually arrives: five of this, ten of that.
  const [quantities, setQuantities] = useState<number[]>([]);
  const [quantityKey, setQuantityKey] = useState("");
  // How many of each design actually went down, so a row can show that it fell
  // short rather than leaving the user to compare two totals.
  const [placedPerDesign, setPlacedPerDesign] = useState<number[] | null>(null);

  const open = useCallback(async (file: File) => {
    setState({ status: "reading", name: file.name });
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const doc = await loadPdf(file);
      const page = await extractPageGeometry(doc, 1);
      const layers = summariseLayers(page);
      setResult(null);
      setStale(false);
      setView("source");
      setCutLayer(guessCutLayer(layers));
      setState({ status: "ready", name: file.name, doc, bytes, page, layers });
    } catch (error) {
      setState({
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (file) void open(file);
    },
    [open]
  );

  const cutPaths = useMemo(
    () =>
      state.status === "ready"
        ? state.page.paths.filter(
            (p) => p.layer === cutLayer && looksLikeCutLine(p)
          )
        : [],
    [state, cutLayer]
  );

  // A different layer means different shapes, so the quantities start again.
  // Adjusted during render rather than in an effect: React re-renders before
  // committing, so the list never paints with quantities belonging to the
  // layer that was showing a moment ago.
  const shapesKey = `${cutLayer ?? ""}:${cutPaths.length}`;
  if (shapesKey !== quantityKey) {
    setQuantityKey(shapesKey);
    setQuantities(cutPaths.map(() => 1));
    setPlacedPerDesign(null);
    setResult(null);
    setStale(false);
    setView("source");
  }

  const requestedTotal = useMemo(
    () => quantities.reduce((sum, n) => sum + n, 0),
    [quantities]
  );

  const runNest = useCallback(async () => {
    if (!cutPaths.length || requestedTotal === 0) return;

    const usableMm2 =
      (sheet.widthMm - sheet.marginLeftMm - sheet.marginRightMm) *
      (sheet.heightMm - sheet.marginTopMm - sheet.marginBottomMm);

    // Filling the sheet is not a mode the engine has: it is asking for more
    // than can fit and letting it report what did not. Multiplying every
    // quantity by the same factor keeps the mix the order asked for, so five
    // of one and ten of another stays one to two however many times it repeats.
    let repeat = 1;
    if (nestOptions.fillSheet) {
      const mixAreaMm2 = cutPaths.reduce((sum, path, index) => {
        const areaMm2 =
          (path.bounds.maxX - path.bounds.minX) *
          PT_TO_MM *
          ((path.bounds.maxY - path.bounds.minY) * PT_TO_MM);
        return sum + areaMm2 * (quantities[index] ?? 0);
      }, 0);
      if (mixAreaMm2 > 0)
        repeat = Math.max(1, Math.ceil((usableMm2 / mixAreaMm2) * 1.4));
    }

    const designs = cutPaths
      .map((path, index) => ({
        id: `cut-${index}`,
        paths: [path],
        quantity: (quantities[index] ?? 0) * repeat,
        sourceIndex: index,
      }))
      .filter((design) => design.quantity > 0);

    // Asking for more than a few hundred makes the search spend its whole
    // budget on pieces that were never going to fit.
    const asked = designs.reduce((sum, d) => sum + d.quantity, 0);
    if (asked > 600) {
      const scale = 600 / asked;
      for (const design of designs)
        design.quantity = Math.max(1, Math.floor(design.quantity * scale));
    }

    setNesting(true);
    try {
      const nested =
        await nest(
          designs,
          {
            widthMm: sheet.widthMm,
            heightMm: sheet.heightMm,
            marginLeftMm: sheet.marginLeftMm,
            marginRightMm: sheet.marginRightMm,
            marginTopMm: sheet.marginTopMm,
            marginBottomMm: sheet.marginBottomMm,
          },
          {
            gapMm: sheet.spacingMm,
            rotationStepDeg: nestOptions.rotationStepDeg,
            timeBudgetSeconds: nestOptions.effortSeconds,
            maxSheets: 1,
            direction: toEngineDirection(sheet.alignment, sheet.direction),
            allowRotation: nestOptions.allowRotation,
          }
        );

      // The engine drops any design whose paths produced no outline, so its
      // indices are not ours. Its own report carries the mapping.
      const mapping = new Map<number, (typeof cutPaths)[number]>();
      nested.designs?.forEach((report, index) => {
        const source = designs[index]?.sourceIndex;
        if (report.designIndex >= 0 && source !== undefined)
          mapping.set(report.designIndex, cutPaths[source]);
      });

      // Counted back against the rows the user typed into, not the engine's
      // own indices, and divided by the repeat so "placed" compares with what
      // was asked for rather than with what filling multiplied it to.
      const perDesign = cutPaths.map(() => 0);
      for (const placement of nested.placements ?? []) {
        const path = mapping.get(placement.designIndex);
        const row = path ? cutPaths.indexOf(path) : -1;
        if (row >= 0) perDesign[row] += 1;
      }
      setPlacedPerDesign(perDesign);

      setPathForDesign(mapping);
      setResult(nested);
      setStale(false);
      if (nested.ok && nested.placements.length) setView("layout");
    } finally {
      setNesting(false);
    }
  }, [cutPaths, sheet, nestOptions, quantities, requestedTotal]);

  const download = useCallback(async () => {
    if (state.status !== "ready" || !result?.ok) return;
    setSaving(true);
    try {
      const pdf = await exportNestedPdf({
        sourceBytes: state.bytes,
        result,
        pathForDesign,
        sheet,
      });
      const blob = new Blob([pdf as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = state.name.replace(/\.pdf$/i, "") + " nested.pdf";
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setSaving(false);
    }
  }, [state, result, pathForDesign, sheet]);

  // A preview wide enough to see the cut lines but not so wide it needs
  // scrolling on a laptop.
  const scale = useMemo(() => {
    if (state.status !== "ready") return 1;
    return Math.min(620 / state.page.width, 760 / state.page.height);
  }, [state]);

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-200">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold text-white">Sticker Nest</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Drop a print-and-cut PDF to read its cut contours.
          </p>
        </header>

        {state.status !== "ready" ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`flex h-80 flex-col items-center justify-center rounded-xl border-2 border-dashed transition ${
              dragging
                ? "border-cyan-400 bg-cyan-400/5"
                : "border-neutral-800 bg-neutral-900/40"
            }`}
          >
            {state.status === "reading" ? (
              <p className="text-sm text-neutral-400">Reading {state.name}…</p>
            ) : (
              <>
                <p className="text-neutral-300">Drop a PDF here</p>
                <label className="mt-4 cursor-pointer rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-white">
                  Choose a file
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void open(file);
                    }}
                  />
                </label>
                {state.status === "failed" && (
                  <p className="mt-6 max-w-md text-center text-sm text-rose-400">
                    {state.message}
                  </p>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
            <div className="space-y-3">
              {result?.ok && result.placements.length > 0 && (
                <div className="flex items-center gap-2">
                  {(["source", "layout"] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setView(mode)}
                      className={`rounded-md px-3 py-1 text-xs transition ${
                        view === mode
                          ? "bg-neutral-100 text-neutral-900"
                          : "bg-neutral-900 text-neutral-400 hover:text-neutral-200"
                      }`}
                    >
                      {mode === "source" ? "Original sheet" : "Nested layout"}
                    </button>
                  ))}
                  {stale && (
                    <span className="text-xs text-amber-400">
                      Settings changed. Nest again to update.
                    </span>
                  )}
                </div>
              )}

              <div className="flex justify-center">
                {view === "layout" && result?.ok ? (
                  <LayoutView
                    result={result}
                    pathForDesign={pathForDesign}
                    sheet={sheet}
                    scale={Math.min(
                      620 / (sheet.widthMm * (72 / 25.4)),
                      760 / (sheet.heightMm * (72 / 25.4))
                    )}
                  />
                ) : (
                  <SheetView
                    doc={state.doc}
                    page={state.page}
                    cutLayer={cutLayer}
                    highlight={highlight}
                    scale={scale}
                  />
                )}
              </div>
            </div>

            <aside className="space-y-6 text-sm">
              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Sheet
                </h2>
                <dl className="mt-2 space-y-1">
                  <Row label="File" value={state.name} />
                  <Row
                    label="Size"
                    value={`${(state.page.width * PT_TO_MM).toFixed(0)} × ${(
                      state.page.height * PT_TO_MM
                    ).toFixed(0)} mm`}
                  />
                  <Row label="Paths" value={String(state.page.paths.length)} />
                  <Row
                    label="Skipped"
                    value={`${state.page.skipped.images} images, ${state.page.skipped.text} text`}
                  />
                </dl>
              </section>

              <section>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Layers
                </h2>
                <p className="mt-1 text-xs text-neutral-500">
                  Pick the one holding the cut contours. Hover to isolate.
                </p>
                <ul className="mt-3 space-y-2">
                  {state.layers.map((layer) => {
                    const chosen = layer.name === cutLayer;
                    return (
                      <li key={layer.label}>
                        <button
                          onClick={() => setCutLayer(layer.name)}
                          onMouseEnter={() => setHighlight(layer.name)}
                          onMouseLeave={() => setHighlight(null)}
                          className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                            chosen
                              ? "border-cyan-400/60 bg-cyan-400/10"
                              : "border-neutral-800 bg-neutral-900/60 hover:border-neutral-700"
                          }`}
                        >
                          <div className="flex items-baseline justify-between">
                            <span className="font-medium text-neutral-100">
                              {layer.label}
                            </span>
                            <span
                              className={
                                chosen ? "text-cyan-300" : "text-neutral-500"
                              }
                            >
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
              </section>

              <SheetSettingsPanel
                sheet={sheet}
                nesting={nestOptions}
                onChange={(next) => {
                  setSheet(next);
                  if (result) setStale(true);
                }}
                onLoadPreset={(preset: Preset) => {
                  setSheet(preset.sheet);
                  setNestOptions(preset.nesting);
                }}
                pageSizeMm={{
                  width: state.page.width * PT_TO_MM,
                  height: state.page.height * PT_TO_MM,
                }}
              />

              {cutLayer !== null && cutPaths.length > 0 && (
                <Section title="Quantities">
                  <DesignList
                    designs={cutPaths}
                    quantities={quantities}
                    onChange={(next) => {
                      setQuantities(next);
                      if (result) setStale(true);
                    }}
                    placedPerDesign={placedPerDesign}
                  />
                </Section>
              )}

              <NestSettingsPanel
                nesting={nestOptions}
                onChange={(next) => {
                  setNestOptions(next);
                  if (result) setStale(true);
                }}
                pieceCount={requestedTotal}
                busy={nesting}
                onRun={() => void runNest()}
              />

              {result && (
                <section>
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Result
                  </h2>
                  {result.ok ? (
                    <dl className="mt-2 space-y-1">
                      <Row
                        label="Placed"
                        value={`${result.placements.length} of ${result.validation.requested}`}
                      />
                      <Row
                        label="Utilization"
                        value={`${(result.utilization * 100).toFixed(1)} %`}
                      />
                      <Row
                        label="Search"
                        value={`${result.generations} generations in ${result.elapsedSeconds.toFixed(1)} s`}
                      />
                      <Row
                        label="Validation"
                        value={result.validation.ok ? "passed" : "FAILED"}
                      />
                    </dl>
                  ) : null}
                  {result.ok && result.validation.ok && (
                    <button
                      onClick={() => void download()}
                      disabled={saving || stale}
                      className="mt-3 w-full rounded-md border border-neutral-700 px-4 py-2 text-sm text-neutral-200 transition hover:border-neutral-500 disabled:opacity-40"
                    >
                      {saving ? "Writing…" : "Download PDF"}
                    </button>
                  )}
                  {result.ok && !result.validation.ok && (
                    <p className="mt-2 text-xs text-rose-400">
                      The layout did not pass validation, so it cannot be
                      exported.
                    </p>
                  )}
                  {!result.ok && (
                    <p className="mt-2 text-xs text-rose-400">{result.error}</p>
                  )}
                </section>
              )}

              <button
                onClick={() => setState({ status: "empty" })}
                className="text-xs text-neutral-500 underline underline-offset-4 hover:text-neutral-300"
              >
                Open a different file
              </button>
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="truncate text-neutral-200">{value}</dd>
    </div>
  );
}
