"use client";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass, ghostButtonClass } from "@/components/ui/card";

export function SyncButtons() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(label: string, steps: string[]) {
    setBusy(label); setMsg(null);
    try {
      const res = await fetch("/api/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ steps }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "falha");
      const problems: string[] = [];
      for (const [step, v] of Object.entries(data)) {
        if (v && !Array.isArray(v) && typeof v === "object" && "error" in v) problems.push(`${step}: ${(v as { error: string }).error}`);
      }
      for (const b of (data.benchmarks ?? []) as { key: string; ok: boolean; error?: string }[]) if (!b.ok) problems.push(`${b.key}: ${b.error}`);
      const quotes = (data.quotes ?? []) as { ticker: string; status: string; message?: string }[];
      const qErr = quotes.filter((q) => q.status === "error");
      const qSkip = quotes.filter((q) => q.status === "skipped").length;
      const qOk = quotes.filter((q) => q.status === "ok").length;
      const qFresh = quotes.filter((q) => q.status === "fresh").length;
      if (qErr.length) problems.push(`cotações com erro: ${qErr.slice(0, 3).map((q) => `${q.ticker} (${q.message})`).join("; ")}${qErr.length > 3 ? ` (+${qErr.length - 3})` : ""}`);
      if (qSkip) problems.push(`${qSkip} cotações puladas (provedor limitado; tente novamente em alguns minutos)`);
      const summary = quotes.length ? ` Cotações: ${qOk} atualizadas, ${qFresh} já em dia.` : "";
      setMsg(problems.length ? `Concluído com avisos.${summary} ${problems.join(" | ")}` : `Atualizado com sucesso.${summary}`);
      router.refresh();
    } catch (e) { setMsg(e instanceof Error ? e.message : "erro"); }
    finally { setBusy(null); }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button className={buttonClass} disabled={!!busy} onClick={() => run("all", ["benchmarks", "quotes", "snapshots"])}>
        <RefreshCw size={16} className={busy === "all" ? "animate-spin" : ""} /> Atualizar cotações e benchmarks
      </button>
      <button className={ghostButtonClass} disabled={!!busy} onClick={() => run("snap", ["snapshots"])}>Recalcular snapshots</button>
      {msg && <span className="text-sm text-slate-400">{msg}</span>}
    </div>
  );
}
