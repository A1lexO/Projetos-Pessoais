import clsx from "clsx";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { brl, CLASS_LABELS, dateBR, num, pct, tone } from "@/lib/format";
import { getAssetsTable, getReconcile } from "@/lib/services/queries";

export const dynamic = "force-dynamic";

export default async function AtivosPage({ searchParams }: { searchParams: Promise<{ classe?: string }> }) {
  const { classe } = await searchParams;
  const [data, rec] = await Promise.all([getAssetsTable(classe), getReconcile()]);
  if (!data) return <EmptyState />;
  const tab = (href: string, label: string, active: boolean) => (
    <Link key={href} href={href} className={clsx("rounded-md px-3 py-1.5 text-sm", active ? "bg-surface text-accent" : "text-slate-400 hover:text-slate-200")}>{label}</Link>
  );
  return (
    <>
    {rec && rec.total > 0 && (
      <Link href="/conferencia" className="block rounded-lg border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-200 hover:bg-amber-400/15">
        {rec.total} ponto(s) de conferência: frações, recibos ou ativos sem cotação recente. Ver Conferência →
      </Link>
    )}
    <Card title={`Meus ativos · posição em ${dateBR(data.date)}`}>
      <div className="mb-4 flex flex-wrap gap-1">
        {tab("/ativos", `Todos (${data.totalCount})`, !classe)}
        {data.classes.map((c) => tab(`/ativos?classe=${c.assetClass}`, `${CLASS_LABELS[c.assetClass] ?? c.assetClass} (${c.count})`, classe === c.assetClass))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-400">
              {["Ativo", "Qtd", "Preço médio", "Cotação", "Saldo", "Resultado", "Rent.", "YoC 12M", "Peso"].map((h, i) => (
                <th key={h} className={clsx("py-2 font-normal", i > 0 && "text-right")}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.ticker} className="border-t border-surface-border">
                <td className="py-2"><Link href={`/extrato/${r.ticker}`} className="font-medium hover:text-accent hover:underline">{r.ticker}</Link><div className="text-xs text-slate-500">{CLASS_LABELS[r.assetClass] ?? r.assetClass}</div></td>
                <td className="py-2 text-right tabular-nums">{num(r.quantity, 4)}{r.fraction > 0 && <span title="quantidade fracionada" className="ml-1 text-amber-300">●</span>}</td>
                <td className="py-2 text-right tabular-nums">{brl(r.averagePrice)}</td>
                <td className="py-2 text-right tabular-nums">{brl(r.price)}</td>
                <td className="py-2 text-right tabular-nums">{brl(r.marketValue)}</td>
                <td className={clsx("py-2 text-right tabular-nums", tone(r.pnlValue))}>{brl(r.pnlValue)}</td>
                <td className={clsx("py-2 text-right tabular-nums", r.pnlPct != null && tone(r.pnlPct))}>{pct(r.pnlPct)}</td>
                <td className="py-2 text-right tabular-nums">{pct(r.yoc)}</td>
                <td className="py-2 text-right tabular-nums">{pct(r.weight, 1)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-surface-border font-medium">
              <td className="py-2">Total</td><td /><td /><td />
              <td className="py-2 text-right tabular-nums">{brl(data.totals.marketValue)}</td>
              <td className={clsx("py-2 text-right tabular-nums", tone(data.totals.pnlValue))}>{brl(data.totals.pnlValue)}</td>
              <td className={clsx("py-2 text-right tabular-nums", tone(data.totals.pnlValue))}>{pct(data.totals.cost > 0 ? data.totals.pnlValue / data.totals.cost : null)}</td>
              <td /><td className="py-2 text-right tabular-nums">{pct(data.totals.weight, 1)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-500">Rentabilidade = cotação vs. preço médio (não inclui proventos). Renda fixa: saldo na curva, bruto de IR/IOF. YoC = proventos líquidos 12M ÷ custo.</p>
    </Card>
    </>
  );
}
