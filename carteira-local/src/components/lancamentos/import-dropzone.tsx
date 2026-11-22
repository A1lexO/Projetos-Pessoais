"use client";
import { FileSpreadsheet, UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { buttonClass, ghostButtonClass } from "@/components/ui/card";
import type { ImportPreview } from "@/lib/import/importer";

interface CommitResult {
  inserted: { transactions: number; proventos: number }; duplicates: number; createdAssets: number;
  rebuilt: { days: number; warnings: string[] } | null; batchId: string | null;
}

export function ImportDropzone() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  async function post<T>(url: string, f: File): Promise<T> {
    const fd = new FormData();
    fd.append("file", f);
    const res = await fetch(url, { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "falha");
    return data as T;
  }

  async function pick(f: File | undefined) {
    if (!f) return;
    setFile(f); setPreview(null); setResult(null); setError(null); setBusy(true);
    try { setPreview(await post<ImportPreview>("/api/import/preview", f)); }
    catch (e) { setError(e instanceof Error ? e.message : "erro"); }
    finally { setBusy(false); }
  }

  async function confirm() {
    if (!file) return;
    setBusy(true); setError(null);
    try { setResult(await post<CommitResult>("/api/import/commit", file)); setPreview(null); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "erro"); }
    finally { setBusy(false); }
  }

  const reset = () => { setFile(null); setPreview(null); setResult(null); setError(null); if (input.current) input.current.value = ""; };
  const nothingNew = preview && preview.transactions.new + preview.proventos.new === 0;

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0]); }}
        onClick={() => input.current?.click()}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-8 text-center ${over ? "border-accent bg-surface" : "border-surface-border"}`}
      >
        <UploadCloud className="text-slate-400" />
        <p className="text-sm text-slate-300">Arraste a planilha da B3 aqui ou clique para escolher</p>
        <p className="text-xs text-slate-500">.xlsx ou .csv · Negociação e Movimentação (Área do Investidor)</p>
        <input ref={input} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      </div>

      {busy && <p className="text-sm text-slate-400">Processando…</p>}
      {error && <p className="rounded-md border border-negative/40 bg-negative/10 p-3 text-sm text-negative">{error}</p>}

      {preview && (
        <div className="space-y-3 rounded-lg border border-surface-border bg-surface p-4 text-sm">
          <div className="flex items-center gap-2 font-medium"><FileSpreadsheet size={16} /> {preview.fileName} <span className="text-xs font-normal text-slate-500">({preview.kind.replace("B3_", "")}, {preview.rowsTotal} linhas)</span></div>
          <table className="w-full text-left">
            <thead className="text-xs text-slate-400"><tr><th className="font-normal"></th><th className="text-right font-normal">Novas</th><th className="text-right font-normal">Duplicadas (ignoradas)</th></tr></thead>
            <tbody className="tabular-nums">
              <tr><td>Operações</td><td className="text-right text-accent">{preview.transactions.new}</td><td className="text-right">{preview.transactions.duplicate}</td></tr>
              <tr><td>Proventos</td><td className="text-right text-accent">{preview.proventos.new}</td><td className="text-right">{preview.proventos.duplicate}</td></tr>
            </tbody>
          </table>
          {preview.events.length > 0 && (
            <p className="text-xs text-slate-300">Eventos corporativos: {preview.events.map((e) => `${e.count}× ${e.type}`).join(", ")}</p>
          )}
          {preview.dateRange && <p className="text-xs text-slate-500">Período das novas linhas: {preview.dateRange.from} a {preview.dateRange.to}</p>}
          {preview.unknownAssets.length > 0 && (
            <div>
              <p className="font-medium text-slate-300">Ativos novos que serão cadastrados ({preview.unknownAssets.length})</p>
              <p className="text-xs text-slate-400">{preview.unknownAssets.map((u) => `${u.ticker} (${u.assetClass}${u.confident ? "" : "?"})`).join(", ")}</p>
            </div>
          )}
          {preview.alerts.length > 0 && <ul className="list-disc space-y-1 pl-5 text-xs text-amber-300">{preview.alerts.map((a) => <li key={a}>{a}</li>)}</ul>}
          {preview.skipped.length > 0 && (
            <details className="text-xs text-slate-400"><summary className="cursor-pointer">Linhas ignoradas ({preview.skipped.reduce((a, s) => a + s.count, 0)})</summary>
              <ul className="mt-1 list-disc pl-5">{preview.skipped.map((s) => <li key={s.reason}>{s.count}× {s.reason}</li>)}</ul>
            </details>
          )}
          {preview.issueCount > 0 && (
            <details className="text-xs text-negative"><summary className="cursor-pointer">Linhas com erro ({preview.issueCount})</summary>
              <ul className="mt-1 list-disc pl-5">{preview.issues.map((i, k) => <li key={k}>linha {i.row}: {i.message}</li>)}</ul>
            </details>
          )}
          <div className="flex gap-2 pt-1">
            <button className={buttonClass} disabled={busy || !!nothingNew} onClick={confirm}>{nothingNew ? "Nada novo para importar" : "Confirmar importação"}</button>
            <button className={ghostButtonClass} onClick={reset}>Cancelar</button>
          </div>
        </div>
      )}

      {result && (
        <div className="space-y-1 rounded-lg border border-accent/40 bg-accent/10 p-4 text-sm">
          <p className="font-medium text-accent">Importação concluída</p>
          <p>{result.inserted.transactions} operações e {result.inserted.proventos} proventos inseridos · {result.duplicates} duplicadas ignoradas · {result.createdAssets} ativos criados.</p>
          {result.rebuilt && <p className="text-xs text-slate-400">Snapshots recalculados ({result.rebuilt.days} dias){result.rebuilt.warnings.length ? ` · ${result.rebuilt.warnings.length} avisos do motor` : ""}. Use “Atualizar cotações” para buscar preços dos ativos novos.</p>}
          <button className={ghostButtonClass} onClick={reset}>Importar outro arquivo</button>
        </div>
      )}
    </div>
  );
}
