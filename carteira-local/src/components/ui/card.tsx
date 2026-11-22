import clsx from "clsx";

export function Card({ title, action, children, className }: { title?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={clsx("rounded-xl border border-surface-border bg-surface-raised p-5", className)}>
      {(title || action) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-sm font-medium text-slate-300">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, valueClass }: { label: string; value: string; sub?: React.ReactNode; valueClass?: string }) {
  return (
    <div className="rounded-xl border border-surface-border bg-surface-raised p-5">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className={clsx("mt-2 text-2xl font-semibold tabular-nums", valueClass)}>{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

export const inputClass =
  "w-full rounded-md border border-surface-border bg-surface px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-accent focus:outline-none";
export const buttonClass =
  "inline-flex items-center gap-2 rounded-md bg-accent-muted px-3 py-2 text-sm font-medium text-slate-950 hover:bg-accent disabled:opacity-50";
export const ghostButtonClass =
  "inline-flex items-center gap-2 rounded-md border border-surface-border px-3 py-2 text-sm text-slate-300 hover:bg-surface disabled:opacity-50";
