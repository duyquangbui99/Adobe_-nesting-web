"use client";

import { useCallback, useMemo, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

import SheetView from "@/components/SheetView";
import { nest, type NestResult } from "@/lib/engine";
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
  const [gapMm, setGapMm] = useState(2);
  const [budget, setBudget] = useState(2);
  const [nesting, setNesting] = useState(false);
  const [result, setResult] = useState<NestResult | null>(null);

  const open = useCallback(async (file: File) => {
    setState({ status: "reading", name: file.name });
    try {
      const doc = await loadPdf(file);
      const page = await extractPageGeometry(doc, 1);
      const layers = summariseLayers(page);
      setResult(null);
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

  const runNest = useCallback(async () => {
    if (state.status !== "ready") return;
    // One design per cut contour, one copy each, which is what a re-nest of an
    // existing sheet means. Quantities become a setting once this is proven.
    const designs = state.page.paths
      .filter((p) => p.layer === cutLayer && looksLikeCutLine(p))
      .map((path, index) => ({
        id: `cut-${index}`,
        paths: [path],
        quantity: 1,
      }));
    if (!designs.length) return;

    setNesting(true);
    try {
      setResult(
        await nest(
          designs,
          {
            widthMm: state.page.width * PT_TO_MM,
            heightMm: state.page.height * PT_TO_MM,
            marginMm: 5,
          },
          { gapMm, rotationStepDeg: 15, timeBudgetSeconds: budget, maxSheets: 1 }
        )
      );
    } finally {
      setNesting(false);
    }
  }, [state, cutLayer, gapMm, budget]);

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
            <div className="flex justify-center">
              <SheetView
                doc={state.doc}
                page={state.page}
                cutLayer={cutLayer}
                highlight={highlight}
                scale={scale}
              />
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

              {cutLayer !== null && (
                <section>
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Nest
                  </h2>
                  <div className="mt-3 space-y-3">
                    <Slider
                      label="Gap"
                      value={gapMm}
                      min={0}
                      max={10}
                      step={0.5}
                      suffix=" mm"
                      onChange={setGapMm}
                    />
                    <Slider
                      label="Effort"
                      value={budget}
                      min={1}
                      max={20}
                      step={1}
                      suffix=" s"
                      onChange={setBudget}
                    />
                    <button
                      onClick={() => void runNest()}
                      disabled={nesting}
                      className="w-full rounded-md bg-cyan-400 px-4 py-2 text-sm font-medium text-neutral-950 transition hover:bg-cyan-300 disabled:opacity-50"
                    >
                      {nesting ? "Nesting…" : "Nest this sheet"}
                    </button>
                    <p className="text-xs text-neutral-600">
                      The engine runs on this thread, so the page will sit still
                      for the effort you asked for.
                    </p>
                  </div>
                </section>
              )}

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

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <div className="flex justify-between text-xs">
        <span className="text-neutral-400">{label}</span>
        <span className="tabular-nums text-neutral-200">
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-cyan-400"
      />
    </label>
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
