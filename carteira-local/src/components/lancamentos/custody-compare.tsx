"use client";
import clsx from "clsx";
import { useState } from "react";
import { buttonClass, inputClass } from "@/components/ui/card";
import type { DiffRow } from "@/lib/reconcile/custody";

const LABEL: Record<DiffRow["kind"], string> = {
  ok: "ok", fraction: "fração", receipt: "recibo", ticker_swap: "troca de ticker", missing_in_system: "falta no sistema", missing_in_custody: "falta na custódia", other: "divergência",
};

export function CustodyCompare() {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<DiffRow[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showOk, setShowOk] = useState(false);

  async function run() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/reconcile/compare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "falha");
      setRows(data.rows); setErrors(data.errors);
    } catch (e) { setError(e instanceof Error ? e.message : "erro"); }
    finally { setBusy(false); }
  }

  const shown = rows?.filter((r) => showOk || r.kind !== "ok") ?? [];
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-400">Cole a posição da sua corretora (uma linha por ativo: <code className="rounded bg-surface px-1">TICKER QUANTIDADE</code>). Ativos que estão no sistema e não na lista aparecem como “falta na custódia”.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder={"KLBN11 900\nKNSC11 450\nAUAU3 900"} className={`${inputClass} font-mono`} />
      <div className="flex items-center gap-3">
        <button className={buttonClass} disabled={busy || !text.trim()} onClick={run}>{busy ? "Comparando…" : "Comparar"}</button>
        {rows && <label className="flex items-center gap-2 text-xs text-slate-400"><input type="checkbox" checked={showOk} onChange={(e) => setShowOk(e.target.checked)} /> mostrar os que batem</label>}
      </div>
      {error && <p className="text-sm text-negative">{error}</p>}
      {errors.length > 0 && <ul className="list-disc pl-5 text-xs text-amber-300">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      {rows && (
        <div className="overflow-x-auto">
          <p className="mb-2 text-sm text-slate-300">{rows.filter((r) => r.kind !== "ok").length} divergência(s) em {rows.length} ativos.</p>
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="text-left text-xs text-slate-400"><th className="py-1 font-normal">Ativo</th><th className="text-right font-normal">Sistema</th><th className="text-right font-normal">Custódia</th><th className="text-right font-normal">Dif.</th><th className="pl-4 font-normal">Causa provável</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.ticker} className="border-t border-surface-border align-top">
                  <td className="py-2 font-medium"><a href={`/extrato/${r.ticker}`} className="hover:text-accent hover:underline">{r.ticker}</a></td>
                  <td className="py-2 text-right tabular-nums">{r.system}</td>
                  <td className="py-2 text-right tabular-nums">{r.real}</td>
                  <td className={clsx("py-2 text-right tabular-nums", r.kind === "ok" ? "text-slate-500" : "text-amber-300")}>{r.kind === "ok" ? "0" : Number(r.diff.toFixed(6))}</td>
                  <td className="py-2 pl-4 text-xs text-slate-300"><span className="mr-2 rounded bg-surface px-1.5 py-0.5 text-slate-400">{LABEL[r.kind]}</span>{r.hint}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
