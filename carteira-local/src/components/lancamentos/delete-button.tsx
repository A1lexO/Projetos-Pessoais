"use client";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeleteButton({ endpoint, label = "este lançamento" }: { endpoint: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      title="Excluir" disabled={busy} className="text-slate-500 hover:text-negative disabled:opacity-40"
      onClick={async () => {
        if (!confirm(`Excluir ${label}? Os snapshots serão recalculados.`)) return;
        setBusy(true);
        const res = await fetch(endpoint, { method: "DELETE" });
        setBusy(false);
        if (!res.ok) alert((await res.json()).error ?? "falha ao excluir");
        router.refresh();
      }}
    ><Trash2 size={15} /></button>
  );
}
