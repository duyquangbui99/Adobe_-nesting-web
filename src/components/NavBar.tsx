"use client";

interface Props {
  fileName: string | null;
  cutLayerLabel: string | null;
  onOpenLayers: () => void;
  onOpenSheet: () => void;
  onOpenFile: (file: File) => void;
  onDownload: () => void;
  canDownload: boolean;
  downloading: boolean;
  sheetSummary: string;
}

export default function NavBar({
  fileName,
  cutLayerLabel,
  onOpenLayers,
  onOpenSheet,
  onOpenFile,
  onDownload,
  canDownload,
  downloading,
  sheetSummary,
}: Props) {
  return (
    <nav className="sticky top-0 z-40 border-b border-neutral-800 bg-neutral-950/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-6 py-3">
        <span className="font-semibold text-white">Sticker Nest</span>

        {fileName && (
          <span className="truncate text-sm text-neutral-500" title={fileName}>
            {fileName}
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {fileName && (
            <>
              <NavButton onClick={onOpenLayers}>
                Cut layer
                <Value>{cutLayerLabel ?? "none"}</Value>
              </NavButton>
              <NavButton onClick={onOpenSheet}>
                Sheet
                <Value>{sheetSummary}</Value>
              </NavButton>
            </>
          )}

          <label className="cursor-pointer rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 transition hover:border-neutral-500 hover:text-neutral-100">
            {fileName ? "Open another" : "Open PDF"}
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onOpenFile(file);
                // Cleared so choosing the same file twice still fires.
                event.target.value = "";
              }}
            />
          </label>

          <button
            onClick={onDownload}
            disabled={!canDownload || downloading}
            className="rounded-md bg-cyan-400 px-3 py-1.5 text-sm font-medium text-neutral-950 transition hover:bg-cyan-300 disabled:opacity-30"
          >
            {downloading ? "Writing…" : "Download PDF"}
          </button>
        </div>
      </div>
    </nav>
  );
}

function NavButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-baseline gap-2 rounded-md border border-neutral-800 px-3 py-1.5 text-sm text-neutral-300 transition hover:border-neutral-600 hover:text-neutral-100"
    >
      {children}
    </button>
  );
}

function Value({ children }: { children: React.ReactNode }) {
  return <span className="text-xs tabular-nums text-neutral-500">{children}</span>;
}
