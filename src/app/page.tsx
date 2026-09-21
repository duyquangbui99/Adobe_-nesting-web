"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

import DesignList from "@/components/DesignList";
import { Section } from "@/components/Field";
import LayerPicker from "@/components/LayerPicker";
import LayoutView from "@/components/LayoutView";
import Modal from "@/components/Modal";
import NavBar from "@/components/NavBar";
import NestProgress from "@/components/NestProgress";
import NestSettingsPanel from "@/components/NestSettingsPanel";
import SheetSettingsPanel from "@/components/SheetSettingsPanel";
import SheetView from "@/components/SheetView";
import { nest, type NestResult } from "@/lib/engine";
import { extractPageGeometry, type PageGeometry, type VectorPath } from "@/lib/pdf/extract";
import { exportNestedPdf } from "@/lib/pdf/export";
import { findRegistrationMarks } from "@/lib/pdf/marks";
import { loadPdf } from "@/lib/pdf/load";
import { renderPagePreview, type PagePreview } from "@/lib/pdf/preview";
import {
  guessCutLayer,
  holdsOnlyCutLines,
  looksLikeCutLine,
  summariseLayers,
  PT_TO_MM,
  type LayerSummary,
} from "@/lib/pdf/geometry";
import {
  defaultNesting,
  defaultSheet,
  toEngineDirection,
  type NestingSettings,
  type Preset,
  type SheetSettings,
} from "@/lib/settings";

const MM_TO_PT = 72 / 25.4;

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

  const [quantities, setQuantities] = useState<number[]>([]);
  const [quantityKey, setQuantityKey] = useState("");
  const [placedPerDesign, setPlacedPerDesign] = useState<number[] | null>(null);

  const [nesting, setNesting] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<NestResult | null>(null);
  const [pathForDesign, setPathForDesign] = useState(new Map<number, VectorPath>());
  const [stale, setStale] = useState(false);
  const [view, setView] = useState<"source" | "layout">("source");

  // The source page rendered once, so every sticker can be shown as its
  // artwork rather than as an outline.
  const [preview, setPreview] = useState<PagePreview | null>(null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);

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

      // Rendering is slow enough to be worth doing after the page is usable,
      // and the previews fall back to outlines until it lands.
      setPreview(null);
      void renderPagePreview(doc, 1)
        .then(setPreview)
        .catch(() => setPreview(null));
    } catch (error) {
      setState({
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  const cutPaths = useMemo(
    () =>
      state.status === "ready"
        ? state.page.paths.filter((p) => p.layer === cutLayer && looksLikeCutLine(p))
        : [],
    [state, cutLayer]
  );

  // A different layer means different shapes, so the quantities start again.
  // Adjusted during render rather than in an effect: React re-renders before
  // committing, so the list never paints with quantities belonging to the layer
  // that was showing a moment ago.
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
    // quantity by the same factor keeps the mix the order asked for, so five of
    // one and ten of another stays one to two however many times it repeats.
    let repeat = 1;
    if (nestOptions.fillSheet) {
      const mixAreaMm2 = cutPaths.reduce((sum, path, index) => {
        const areaMm2 =
          (path.bounds.maxX - path.bounds.minX) *
          PT_TO_MM *
          ((path.bounds.maxY - path.bounds.minY) * PT_TO_MM);
        return sum + areaMm2 * (quantities[index] ?? 0);
      }, 0);
      if (mixAreaMm2 > 0) repeat = Math.max(1, Math.ceil((usableMm2 / mixAreaMm2) * 1.4));
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
    setStartedAt(performance.now());
    try {
      const nested = await nest(
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
      const mapping = new Map<number, VectorPath>();
      nested.designs?.forEach((report, index) => {
        const source = designs[index]?.sourceIndex;
        if (report.designIndex >= 0 && source !== undefined)
          mapping.set(report.designIndex, cutPaths[source]);
      });

      // Counted back against the rows the user typed into, not the engine's own
      // indices, so a row can say it fell short.
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
      // Switching the source's cut layer off stops its stroke printing, since
      // our clip runs along the same path and half of it would survive inside
      // every sticker. But only when that layer is cut lines and nothing else:
      // a sheet that draws artwork there too would lose the artwork. Same rule
      // for the marks layer, which we redraw ourselves.
      const marks = findRegistrationMarks(state.page);
      const marksLayer = marks?.shape.layer ?? null;
      const onMarksLayer = state.page.paths.filter((p) => p.layer === marksLayer).length;
      const cutSummary = state.layers.find((l) => l.name === cutLayer);
      const hiddenLayers = [
        cutLayer !== null && cutSummary && holdsOnlyCutLines(cutSummary) ? cutLayer : null,
        marksLayer !== null && onMarksLayer === marks!.found ? marksLayer : null,
      ].filter((name): name is string => name !== null);

      const pdf = await exportNestedPdf({
        sourceBytes: state.bytes,
        result,
        pathForDesign,
        sheet,
        marks,
        hiddenLayers,
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
  }, [state, result, pathForDesign, sheet, cutLayer]);

  // An object URL is a handle the browser holds open; letting them accumulate
  // across a session of opening files is a leak.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  const sourceScale = useMemo(() => {
    if (state.status !== "ready") return 1;
    return Math.min(700 / state.page.width, 760 / state.page.height);
  }, [state]);

  const layoutScale = useMemo(
    () =>
      Math.min(700 / (sheet.widthMm * MM_TO_PT), 760 / (sheet.heightMm * MM_TO_PT)),
    [sheet]
  );

  const markSummary = useMemo(
    () => (state.status === "ready" ? findRegistrationMarks(state.page) : null),
    [state]
  );

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-200">
      <NavBar
        fileName={state.status === "ready" ? state.name : null}
        cutLayerLabel={cutLayer}
        onOpenLayers={() => setLayersOpen(true)}
        onOpenSheet={() => setSheetOpen(true)}
        onOpenFile={(file) => void open(file)}
        onDownload={() => void download()}
        canDownload={Boolean(result?.ok && result.validation.ok && !stale)}
        downloading={saving}
        sheetSummary={`${sheet.widthMm.toFixed(0)} × ${sheet.heightMm.toFixed(0)} mm`}
      />

      <div className="mx-auto max-w-[1600px] px-6 py-6">
        {state.status !== "ready" ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void open(file);
            }}
            className={`flex h-96 flex-col items-center justify-center rounded-xl border-2 border-dashed transition ${
              dragging ? "border-cyan-400 bg-cyan-400/5" : "border-neutral-800 bg-neutral-900/40"
            }`}
          >
            {state.status === "reading" ? (
              <p className="text-sm text-neutral-400">Reading {state.name}…</p>
            ) : (
              <>
                <p className="text-neutral-300">Drop a print-and-cut PDF here</p>
                <p className="mt-2 text-xs text-neutral-600">
                  or use Open PDF in the bar above
                </p>
                {state.status === "failed" && (
                  <p className="mt-6 max-w-md text-center text-sm text-rose-400">
                    {state.message}
                  </p>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_290px_270px]">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                {(["source", "layout"] as const).map((mode) => {
                  const enabled = mode === "source" || Boolean(result?.ok && result.placements.length);
                  return (
                    <button
                      key={mode}
                      disabled={!enabled}
                      onClick={() => setView(mode)}
                      className={`rounded-md px-3 py-1 text-xs transition disabled:opacity-30 ${
                        view === mode
                          ? "bg-neutral-100 text-neutral-900"
                          : "bg-neutral-900 text-neutral-400 hover:text-neutral-200"
                      }`}
                    >
                      {mode === "source" ? "Original sheet" : "Nested layout"}
                    </button>
                  );
                })}
                {stale && (
                  <span className="text-xs text-amber-400">
                    Settings changed. Nest again to update.
                  </span>
                )}
              </div>

              <div className="relative flex justify-center">
                {nesting && (
                  <NestProgress
                    startedAt={startedAt}
                    budgetSeconds={nestOptions.effortSeconds}
                  />
                )}
                {view === "layout" && result?.ok ? (
                  <LayoutView
                    result={result}
                    pathForDesign={pathForDesign}
                    sheet={sheet}
                    preview={preview}
                    scale={layoutScale}
                  />
                ) : (
                  <SheetView
                    doc={state.doc}
                    page={state.page}
                    cutLayer={cutLayer}
                    highlight={highlight}
                    scale={sourceScale}
                  />
                )}
              </div>
            </div>

            <aside className="space-y-3">
              {cutPaths.length > 0 ? (
                <Section title="Quantities">
                  <DesignList
                    designs={cutPaths}
                    quantities={quantities}
                    onChange={(next) => {
                      setQuantities(next);
                      if (result) setStale(true);
                    }}
                    placedPerDesign={placedPerDesign}
                    preview={preview}
                  />
                </Section>
              ) : (
                <Section title="Quantities">
                  <p className="text-xs text-neutral-500">
                    No cut contours on {cutLayer ?? "this layer"}. Choose a
                    different one from Cut layer above.
                  </p>
                </Section>
              )}

            </aside>

            <aside className="space-y-3">
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
                <Section title="Result">
                  {result.ok ? (
                    <>
                      <dl className="space-y-1">
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
                        <Row
                          label="Registration"
                          value={
                            markSummary
                              ? `${markSummary.found} marks, ${markSummary.sizeMm.toFixed(1)} mm`
                              : "none found"
                          }
                        />
                      </dl>
                      {!result.validation.ok && (
                        <p className="mt-2 text-xs text-rose-400">
                          The layout did not pass validation, so it cannot be
                          exported.
                        </p>
                      )}
                      {!markSummary && (
                        <p className="mt-2 text-xs text-amber-400">
                          No registration marks were found in the source, so the
                          exported sheet will have none and a cutter will not be
                          able to align it.
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-rose-400">{result.error}</p>
                  )}
                </Section>
              )}
            </aside>
          </div>
        )}
      </div>

      <Modal open={sheetOpen} title="Sheet setup" onClose={() => setSheetOpen(false)}>
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
            if (result) setStale(true);
          }}
          pageSizeMm={
            state.status === "ready"
              ? {
                  width: state.page.width * PT_TO_MM,
                  height: state.page.height * PT_TO_MM,
                }
              : null
          }
        />
      </Modal>

      <Modal
        open={layersOpen}
        title="Cut layer"
        placement="side"
        onClose={() => {
          setLayersOpen(false);
          setHighlight(null);
        }}
      >
        {state.status === "ready" && (
          <LayerPicker
            layers={state.layers}
            cutLayer={cutLayer}
            onChoose={setCutLayer}
            onHover={setHighlight}
          />
        )}
      </Modal>
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
