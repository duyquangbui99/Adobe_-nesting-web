"use client";

import { useEffect } from "react";

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Wider for panels with two columns of fields. */
  wide?: boolean;
  /**
   * "side" keeps the sheet visible behind, which matters for the layer picker:
   * hovering a row isolates that layer on the sheet, and a dialog sitting over
   * the middle of the screen would hide the very thing being checked.
   */
  placement?: "centre" | "side";
}

export default function Modal({
  open,
  title,
  onClose,
  children,
  wide,
  placement = "centre",
}: Props) {
  // Escape closes, which people expect and which costs nothing.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const side = placement === "side";

  return (
    <div
      className={`fixed inset-0 z-50 flex overflow-y-auto p-6 ${
        side
          ? "justify-end bg-transparent"
          : "items-start justify-center bg-black/70 backdrop-blur-sm"
      }`}
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className={`w-full rounded-xl border border-neutral-800 bg-neutral-950 shadow-2xl ${
          side ? "mt-2 max-w-sm self-start" : "my-auto"
        } ${wide ? "max-w-2xl" : side ? "max-w-sm" : "max-w-md"}`}
      >
        <header className="flex items-center justify-between border-b border-neutral-800 px-5 py-3">
          <h2 className="text-sm font-semibold text-neutral-100">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-neutral-500 transition hover:bg-neutral-900 hover:text-neutral-200"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
