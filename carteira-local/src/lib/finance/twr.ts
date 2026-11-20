import { EPS } from "./average-price.ts";
import type { PortfolioPoint, PortfolioRow } from "./types.ts";

/**
 * Cota diária (TWR), fluxo no início do dia:
 *   r_t = V_t / (V_{t-1} + F_t) − 1       se V_{t-1} + F_t > 0, senão 0
 *   Cota_t = Cota_{t-1} × (1 + r_t)       (cota = base antes do 1º aporte)
 * Dias anteriores ao primeiro aporte não geram ponto.
 */
export function computeQuotaSeries(rows: PortfolioRow[], base = 100): PortfolioPoint[] {
  const out: PortfolioPoint[] = [];
  let prevV = 0;
  let quota = base;
  let started = false;
  for (const row of rows) {
    const denom = prevV + row.netFlow;
    const r = denom > EPS ? row.totalValue / denom - 1 : 0;
    if (!started && denom <= EPS) {
      prevV = row.totalValue;
      continue;
    }
    started = true;
    quota *= 1 + r;
    out.push({ ...row, dailyReturn: r, quota });
    prevV = row.totalValue;
  }
  return out;
}
