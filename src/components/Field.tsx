"use client";

/** Small shared controls, so the two settings panels look like one product. */

export function NumberField({
  label,
  value,
  onChange,
  suffix,
  min = 0,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
  min?: number;
  step?: number;
}) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-xs text-neutral-400">{label}</span>
      <span className="flex items-center gap-1.5">
        <input
          type="number"
          value={value}
          min={min}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-20 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-right text-sm tabular-nums text-neutral-100 focus:border-cyan-400 focus:outline-none"
        />
        {suffix && <span className="w-8 text-xs text-neutral-500">{suffix}</span>}
      </span>
    </label>
  );
}

export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-neutral-400">{label}</span>
      <div className="flex overflow-hidden rounded-md border border-neutral-700">
        {options.map((option) => (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            className={`px-2.5 py-1 text-xs transition ${
              value === option.value
                ? "bg-cyan-400 text-neutral-950"
                : "bg-neutral-900 text-neutral-400 hover:text-neutral-200"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-cyan-400"
      />
      <span>
        <span className="text-xs text-neutral-300">{label}</span>
        {hint && <span className="mt-0.5 block text-[11px] leading-snug text-neutral-600">{hint}</span>}
      </span>
    </label>
  );
}

export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
        {title}
      </h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}
