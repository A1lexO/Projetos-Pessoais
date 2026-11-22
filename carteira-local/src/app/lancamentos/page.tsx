import clsx from "clsx";
import Link from "next/link";
import { BatchesList } from "@/components/lancamentos/batches-list";
import { DeleteButton } from "@/components/lancamentos/delete-button";
import { EditButton } from "@/components/lancamentos/edit-button";
import { ImportDropzone } from "@/components/lancamentos/import-dropzone";
import { ManualForm } from "@/components/lancamentos/manual-form";
import { SyncButtons } from "@/components/lancamentos/sync-buttons";
import { Card, inputClass, ghostButtonClass } from "@/components/ui/card";
import { brl, dateBR, num, TYPE_LABELS } from "@/lib/format";
import { getHistory, getRecentBatches, PAGE_SIZE } from "@/lib/services/queries";

export const dynamic = "force-dynamic";

export default async function LancamentosPage({ searchParams }: { searchParams: Promise<{ aba?: string; q?: string; pagina?: string }> }) {
  const sp = await searchParams;
  const tab = sp.aba === "proventos" ? "proventos" : "operacoes";
  const page = Math.max(1, Number(sp.pagina) || 1);
  const q = sp.q?.trim() || undefined;
  const [history, batches] = await Promise.all([getHistory({ tab, q, page }), getRecentBatches()]);
  const pages = Math.max(1, Math.ceil(history.count / PAGE_SIZE));
  const href = (over: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const merged = { aba: tab, q, pagina: page, ...over } as Record<string, string | number | undefined>;
    for (const [k, v] of Object.entries(merged)) if (v !== undefined && v !== "") p.set(k, String(v));
    return `/lancamentos?${p}`;
  };
  const endpoint = tab === "proventos" ? "/api/proventos" : "/api/transactions";

  return (
    <>
      <SyncButtons />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Importar planilha da B3"><ImportDropzone /></Card>
        <Card title="Novo lançamento manual"><ManualForm /></Card>
      </div>

      <Card title="Histórico">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1">
            {(["operacoes", "proventos"] as const).map((t) => (
              <Link key={t} href={href({ aba: t, pagina: 1 })} className={clsx("rounded-md px-3 py-1.5 text-sm", tab === t ? "bg-surface text-accent" : "text-slate-400 hover:text-slate-200")}>{t === "operacoes" ? "Operações" : "Proventos"}</Link>
            ))}
          </div>
          <form className="flex gap-2" action="/lancamentos">
            <input type="hidden" name="aba" value={tab} />
            <input name="q" defaultValue={q} placeholder="Filtrar por ticker" className={clsx(inputClass, "w-44")} />
            <button className={ghostButtonClass}>Filtrar</button>
          </form>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="text-left text-xs text-slate-400">
              <th className="py-2 font-normal">Data</th><th className="font-normal">Ativo</th><th className="font-normal">Tipo</th>
              <th className="text-right font-normal">Qtd</th><th className="text-right font-normal">Preço</th><th className="text-right font-normal">Valor</th><th className="font-normal pl-4">Origem</th><th />
            </tr></thead>
            <tbody>
              {history.rows.map((r) => (
                <tr key={r.id} className="border-t border-surface-border">
                  <td className="py-2">{dateBR(r.date)}</td>
                  <td className="font-medium">{r.ticker}</td>
                  <td>{TYPE_LABELS[r.type] ?? r.type}{r.counterpart ? ` → ${r.counterpart}` : ""}{r.factor ? ` ×${num(r.factor, 4)}` : ""}</td>
                  <td className="text-right tabular-nums">{r.quantity ? num(r.quantity, 4) : "—"}</td>
                  <td className="text-right tabular-nums">{r.unitPrice ? brl(r.unitPrice) : "—"}</td>
                  <td className="text-right tabular-nums">{r.amount ? brl(r.amount) : "—"}</td>
                  <td className="pl-4 text-xs text-slate-500">{r.source.replace("B3_", "B3 ")}</td>
                  <td className="whitespace-nowrap text-right">{tab === "operacoes" && <EditButton id={r.id} type={r.type} date={r.date} quantity={r.quantity} unitPrice={r.unitPrice ?? 0} fees={r.fees} factor={r.factor} />}<DeleteButton endpoint={`${endpoint}/${r.id}`} /></td>
                </tr>
              ))}
              {!history.rows.length && <tr><td colSpan={8} className="py-6 text-center text-slate-500">Nada encontrado.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex items-center justify-between text-sm text-slate-400">
          <span>{history.count} registros · página {page} de {pages}</span>
          <div className="flex gap-2">
            {page > 1 && <Link className={ghostButtonClass} href={href({ pagina: page - 1 })}>Anterior</Link>}
            {page < pages && <Link className={ghostButtonClass} href={href({ pagina: page + 1 })}>Próxima</Link>}
          </div>
        </div>
      </Card>

      <Card title="Importações recentes"><BatchesList batches={batches} /></Card>
    </>
  );
}
