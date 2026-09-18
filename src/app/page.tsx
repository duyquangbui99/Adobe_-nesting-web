"use client";

import { useCallback, useMemo, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

import NestSettingsPanel from "@/components/NestSettingsPanel";
import SheetSettingsPanel from "@/components/SheetSettingsPanel";
import LayoutView from "@/components/LayoutView";
import SheetView from "@/components/SheetView";
import { nest, type NestResult } from "@/lib/engine";
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

  const open = useCallback(async (file: File) => {
    setState({ status: "reading", name: file.name });
    try {
      const doc = await loadPdf(file);
      const page = await extractPageGeometry(doc, 1);
      const layers = summariseLayers(page);
      setResult(null);
      setStale(false);
      setView("source");
      setCutLayer(guessCutLayer(layers));
      setState({ status: "ready", name: file.name, doc, page, layers });
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

  const runNest = useCallback(async () => {
    if (!cutPaths.length) return;

    const usableMm2 =
      (sheet.widthMm - sheet.marginLeftMm - sheet.marginRightMm) *
      (sheet.heightMm - sheet.marginTopMm - sheet.marginBottomMm);

    const designs = cutPaths.map((path, index) => {
      // Filling the sheet is a quantity the engine never reaches rather than a
      // mode it has: ask for as many as could possibly fit and let it report
      // what did not. Bounded by the bounding box, so the ask stays sane.
      const areaMm2 =
        (path.bounds.maxX - path.bounds.minX) *
        PT_TO_MM *
        ((path.bounds.maxY - path.bounds.minY) * PT_TO_MM);
      const couldFit = areaMm2 > 0 ? Math.floor(usableMm2 / areaMm2) + 2 : 1;
      return {
        id: `cut-${index}`,
        paths: [path],
        quantity: nestOptions.fillSheet
          ? Math.min(couldFit, 400)
          : nestOptions.quantity,
      };
    });

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
      nested.designs?.forEach((design, index) => {
        if (design.designIndex >= 0 && cutPaths[index])
          mapping.set(design.designIndex, cutPaths[index]);
      });

      setPathForDesign(mapping);
      setResult(nested);
      setStale(false);
      if (nested.ok && nested.placements.length) setView("layout");
    } finally {
      setNesting(false);
    }
  }, [cutPaths, sheet, nestOptions]);

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

              <NestSettingsPanel
                nesting={nestOptions}
                onChange={(next) => {
                  setNestOptions(next);
                  if (result) setStale(true);
                }}
                designCount={cutPaths.length}
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
                  ) : (
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
