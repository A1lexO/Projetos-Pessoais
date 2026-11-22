import clsx from "clsx";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { brl, CLASS_LABELS, dateBR, num, tone } from "@/lib/format";
import { getAssetLedger } from "@/lib/services/queries";

export const dynamic = "force-dynamic";

export default async function ExtratoPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const d = await getAssetLedger(decodeURIComponent(ticker).toUpperCase());
  if (!d) notFound();
  return (
    <>
      <Card title={`Extrato de ${d.ticker}`} action={<Link href="/conferencia" className="text-xs text-accent underline">← Conferência</Link>}>
        <p className="mb-4 text-xs text-slate-500">
          {CLASS_LABELS[d.assetClass] ?? d.assetClass} · {d.isActive ? "ativo" : "inativo (não consulta cotações)"} · {d.txCount} lançamentos relacionados.
          Cada linha é um dia em que a quantidade ou o preço médio mudou; entradas e saídas por troca de ticker aparecem junto.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="text-left text-xs text-slate-400"><th className="py-1 font-normal">Data</th><th className="text-right font-normal">Quantidade</th><th className="text-right font-normal">Variação</th><th className="text-right font-normal">Preço médio</th><th className="pl-4 font-normal">Lançamentos</th></tr></thead>
            <tbody>
              {d.rows.map((r, i) => (
                <tr key={i} className="border-t border-surface-border align-top">
                  <td className="py-2">{r.date === "zerada" ? "posição zerada" : dateBR(r.date)}</td>
                  <td className="py-2 text-right tabular-nums">{num(r.quantity, 6)}</td>
                  <td className={clsx("py-2 text-right tabular-nums", r.delta === 0 ? "text-slate-500" : tone(r.delta))}>{r.delta === 0 ? "—" : `${r.delta > 0 ? "+" : ""}${num(r.delta, 6)}`}</td>
                  <td className="py-2 text-right tabular-nums">{brl(r.averagePrice)}</td>
                  <td className="py-2 pl-4 text-xs text-slate-300">{r.events.length ? r.events.map((e, k) => <div key={k}>{e}</div>) : <span className="text-slate-500">ajuste de preço médio</span>}</td>
                </tr>
              ))}
              {!d.rows.length && <tr><td colSpan={5} className="py-6 text-center text-slate-500">Sem posição calculada para este ativo.</td></tr>}
            </tbody>
          </table>
        </div>
        {d.ignored.length > 0 && (
          <div className="mt-4 rounded-md border border-amber-400/40 bg-amber-400/10 p-3 text-xs text-amber-200">
            Lançamentos com data posterior a hoje (ignorados no cálculo): {d.ignored.join("; ")}
          </div>
        )}
      </Card>
      <p className="text-xs text-slate-500">Se a quantidade não bate com a corretora, rode <code className="rounded bg-surface px-1">npm run explain:b3 -- Movimentacao.xlsx {d.ticker}</code> para ver como cada linha da planilha foi interpretada.</p>
    </>
  );
}
