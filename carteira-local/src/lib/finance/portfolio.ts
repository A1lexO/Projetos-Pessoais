import { buildCalendar, nextIndexOnOrAfter } from "./dates.ts";
import type { DayKey } from "./dates.ts";
import { buildRateArrays, cumulativeIndex } from "./fixed-income.ts";
import { computePositions } from "./positions.ts";
import { normalizeSplits } from "./splits.ts";
import { computeQuotaSeries } from "./twr.ts";
import type { EngineInput, PortfolioRow, PortfolioPoint, PositionPoint } from "./types.ts";

export interface PortfolioResult {
  calendar: DayKey[];
  portfolio: PortfolioPoint[];
  positions: PositionPoint[];
  /** índices acumulados alinhados ao calendário (base 1 no 1º dia) */
  benchmarkIndex: { CDI: Float64Array; IPCA: Float64Array; SELIC: Float64Array };
  realizedPnL: Map<string, number>;
  warnings: string[];
}

export function computePortfolio(input: EngineInput): PortfolioResult {
  const empty: PortfolioResult = {
    calendar: [], portfolio: [], positions: [],
    benchmarkIndex: { CDI: new Float64Array(), IPCA: new Float64Array(), SELIC: new Float64Array() },
    realizedPnL: new Map(), warnings: [],
  };
  const dates = [...input.transactions.map((t) => t.date), ...input.proventos.map((p) => p.paymentDate)];
  if (!dates.length) return empty;
  const start = dates.reduce((a, b) => (a < b ? a : b));
  const calendar = buildCalendar(start, input.endDate, (input.benchmarks.cdi ?? []).map((p) => p.date));
  if (!calendar.length) return empty;

  const rates = buildRateArrays(calendar, input.benchmarks);
  const transactions = input.splitAdjustedQuotes === false ? input.transactions : normalizeSplits(input.transactions);
  const pos = computePositions({ ...input, transactions }, calendar, rates);

  const cashDelta = new Float64Array(calendar.length);
  for (const p of input.proventos) {
    const i = nextIndexOnOrAfter(calendar, p.paymentDate);
    if (i >= 0) cashDelta[i] += p.netAmount;
  }
  const rows: PortfolioRow[] = [];
  let cash = 0;
  for (let i = 0; i < calendar.length; i++) {
    cash += cashDelta[i];
    rows.push({
      date: calendar[i],
      marketValue: pos.marketValue[i],
      provCash: cash,
      totalValue: pos.marketValue[i] + cash,
      netFlow: pos.flow[i],
      investedCost: pos.cost[i],
    });
  }
  return {
    calendar,
    portfolio: computeQuotaSeries(rows),
    positions: pos.points,
    benchmarkIndex: { CDI: cumulativeIndex(rates.cdi), IPCA: cumulativeIndex(rates.ipca), SELIC: cumulativeIndex(rates.selic) },
    realizedPnL: pos.realizedPnL,
    warnings: pos.warnings,
  };
}
