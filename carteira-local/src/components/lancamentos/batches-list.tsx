"use client";
import { Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface BatchRow { id: string; fileName: string; fileKind: string; imported: number; skipped: number; failed: number; createdAt: string }

export function BatchesList({ batches }: { batches: BatchRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  if (!batches.length) return <p className="text-sm text-slate-500">Nenhuma importação ainda.</p>;
  return (
    <ul className="divide-y divide-surface-border text-sm">
      {batches.map((b) => (
        <li key={b.id} className="flex items-center justify-between gap-3 py-2">
          <div>
            <div className="font-medium">{b.fileName}</div>
            <div className="text-xs text-slate-500">{b.createdAt} · {b.fileKind.replace("B3_", "")} · {b.imported} importadas, {b.skipped} duplicadas, {b.failed} com erro</div>
          </div>
          <button
            disabled={busy === b.id} className="flex items-center gap-1 text-xs text-slate-400 hover:text-negative disabled:opacity-40"
            onClick={async () => {
              if (!confirm(`Desfazer a importação de "${b.fileName}"? Operações e proventos desse lote serão removidos.`)) return;
              setBusy(b.id);
              const res = await fetch(`/api/import/batches/${b.id}`, { method: "DELETE" });
              setBusy(null);
              if (!res.ok) alert((await res.json()).error ?? "falha");
              router.refresh();
            }}
          ><Undo2 size={14} /> Desfazer</button>
        </li>
      ))}
    </ul>
  );
}
