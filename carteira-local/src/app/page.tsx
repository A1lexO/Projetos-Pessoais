import { AllocationChart } from "@/components/dashboard/allocation-chart";
import { EvolutionChart } from "@/components/dashboard/evolution-chart";
import { WindowTabs } from "@/components/dashboard/window-tabs";
import { Card, Stat } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { WindowKey } from "@/lib/finance/compare";
import { brl, CLASS_LABELS, dateBR, num, pct, tone } from "@/lib/format";
import { getDashboard, WINDOWS, WINDOW_LABELS } from "@/lib/services/queries";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ janela?: string }> }) {
  const sp = await searchParams;
  const janela = (WINDOWS.includes(sp.janela as WindowKey) ? sp.janela : "12M") as WindowKey;
  const d = await getDashboard(janela);
  if (!d) return <EmptyState />;
  const { kpis: k, returns: r } = d;
  const rows = [
    { name: "Carteira", v: r.carteira, strong: true }, { name: "CDI", v: r.cdi }, { name: "IPCA", v: r.ipca },
    ...(d.hasIbov ? [{ name: "Ibovespa", v: r.ibov }] : []),
  ];
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Patrimônio total" value={brl(k.patrimonio)} sub={`Posições ${brl(k.posicoes)} + proventos ${brl(k.provCaixa)}`} />
        <Stat label="Valor aplicado" value={brl(k.aplicado)} sub="Aportes líquidos de resgates" />
        <Stat label="Lucro / prejuízo" value={brl(k.lucro)} valueClass={tone(k.lucro)} sub={k.lucroPct != null ? `${pct(k.lucroPct)} sobre o aplicado` : undefined} />
        <Stat label="Proventos no mês" value={brl(k.provMes)} sub={`Acumulado: ${brl(k.provTotal)}`} />
        <Stat
          label={`Rentabilidade ${WINDOW_LABELS[janela]}`} value={pct(r.carteira)} valueClass={r.carteira != null ? tone(r.carteira) : undefined}
          sub={<>{r.pctCdi != null ? `${num(r.pctCdi, 1)}% do CDI` : "% do CDI indisponível"}{r.ipcaPlus != null && <> · IPCA + {pct(r.ipcaPlus)} a.a.</>}</>}
        />
      </div>

      <Card title="Evolução comparativa (cota TWR)" action={<WindowTabs current={janela} />}>
        <p className="mb-3 text-xs text-slate-500">
          {dateBR(d.start)} a {dateBR(d.end)}{d.clamped && " · histórico menor que a janela: mostrando desde o início"}
        </p>
        <EvolutionChart data={d.chart} showIbov={d.hasIbov} />
        <table className="mt-4 w-full text-sm">
          <thead><tr className="text-left text-xs text-slate-400"><th className="py-1 font-normal">Período</th><th className="py-1 text-right font-normal">Retorno</th></tr></thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.name} className="border-t border-surface-border">
                <td className={x.strong ? "py-1.5 font-medium" : "py-1.5 text-slate-300"}>{x.name}</td>
                <td className={`py-1.5 text-right tabular-nums ${x.v != null ? tone(x.v) : ""}`}>{pct(x.v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Alocação por classe">
        {d.allocation.length ? <AllocationChart data={d.allocation.map((a) => ({ name: CLASS_LABELS[a.assetClass] ?? a.assetClass, value: a.value }))} /> : <p className="text-sm text-slate-400">Sem posições abertas.</p>}
      </Card>
    </>
  );
}
