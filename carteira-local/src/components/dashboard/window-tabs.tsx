import clsx from "clsx";
import Link from "next/link";
import { WINDOWS, WINDOW_LABELS } from "@/lib/services/queries";

export function WindowTabs({ current }: { current: string }) {
  return (
    <div className="flex gap-1 rounded-lg bg-surface p-1">
      {WINDOWS.map((w) => (
        <Link key={w} href={`/?janela=${w}`} className={clsx("rounded-md px-3 py-1 text-xs font-medium", current === w ? "bg-surface-raised text-accent" : "text-slate-400 hover:text-slate-200")}>
          {WINDOW_LABELS[w]}
        </Link>
      ))}
    </div>
  );
}
