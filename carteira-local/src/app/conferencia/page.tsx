import Link from "next/link";
import { CustodyCompare } from "@/components/lancamentos/custody-compare";
import { FractionRow, SwapRow } from "@/components/lancamentos/reconcile-panel";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { dateBR } from "@/lib/format";
import { getReconcile } from "@/lib/services/queries";

export const dynamic = "force-dynamic";

export default async function ConferenciaPage() {
  const d = await getReconcile();
  if (!d) return <EmptyState />;
  return (
    <>
      <Card title="Comparar com a custódia da corretora"><CustodyCompare /></Card>

      <Card title={`Frações residuais (${d.fractions.length})`}>
        {d.fractions.length ? (
          <ul className="divide-y divide-surface-border">{d.fractions.map((f) => <FractionRow key={f.ticker} ticker={f.ticker} quantity={f.quantity} fraction={f.fraction} />)}</ul>
        ) : <p className="text-sm text-slate-500">Nenhum ativo com quantidade fracionada.</p>}
      </Card>

      <Card title={`Recibos de subscrição com posição aberta (${d.conversions.length})`}>
        {d.conversions.length ? (
          <ul className="divide-y divide-surface-border">{d.conversions.map((c) => <SwapRow key={c.from} from={c.from} to={c.to} quantity={c.quantity} note={c.toExists ? "destino já cadastrado" : "destino será criado"} />)}</ul>
        ) : <p className="text-sm text-slate-500">Nenhum recibo (tickers terminados em 12, 13 ou 14) com saldo.</p>}
      </Card>

      <Card title={`Posições sem cotação recente (${d.stale.length})`}>
        <p className="mb-2 text-xs text-slate-500">Costuma indicar ticker incorporado, renomeado ou deslistado. Se for o caso, informe o novo ticker.</p>
        {d.stale.length ? (
          <ul className="divide-y divide-surface-border">{d.stale.map((s) => <SwapRow key={s.ticker} from={s.ticker} to="" quantity={s.quantity} note={s.lastQuoteDate ? `última cotação ${dateBR(s.lastQuoteDate)}` : "nunca cotado"} />)}</ul>
        ) : <p className="text-sm text-slate-500">Todas as posições abertas têm cotação recente.</p>}
      </Card>
      <p className="text-xs text-slate-500">Posição de referência: {dateBR(d.date)}. Desdobramentos e grupamentos: <Link href="/lancamentos" className="text-accent underline">Lançamentos › Desdobramento</Link>.</p>
    </>
  );
}
