import { addDays, addMonths, daysBetween, lastIndexOnOrBefore } from "./dates.ts";
import type { DayKey } from "./dates.ts";

export interface IndexPoint { date: DayKey; value: number }
export type WindowKey = "1M" | "6M" | "YTD" | "12M" | "ALL";

export function toIndexSeries(calendar: DayKey[], values: ArrayLike<number>): IndexPoint[] {
  return calendar.map((date, i) => ({ date, value: values[i] }));
}

/** Data inicial da janela; a base é o último ponto ANTERIOR a ela. */
export function windowStart(w: WindowKey, end: DayKey, first: DayKey): DayKey {
  switch (w) {
    case "1M": return addMonths(end, -1);
    case "6M": return addMonths(end, -6);
    case "12M": return addMonths(end, -12);
    case "YTD": return `${end.slice(0, 4)}-01-01`;
    case "ALL": return first;
  }
}

/** Retorno acumulado em (from, to]. null se não há base (janela começa antes da série). */
export function windowReturn(series: IndexPoint[], from: DayKey, to: DayKey): number | null {
  if (!series.length) return null;
  const dates = series.map((p) => p.date);
  const iEnd = lastIndexOnOrBefore(dates, to);
  if (iEnd < 0) return null;
  let iBase = lastIndexOnOrBefore(dates, addDays(from, -1));
  if (iBase < 0) {
    if (from > dates[0]) return null;
    iBase = 0; // janela pega a série toda: usa o 1º ponto como base
  }
  if (iBase >= iEnd) return null;
  return series[iEnd].value / series[iBase].value - 1;
}

/** Série rebaseada em 100 a partir da data inicial. */
export function rebase(series: IndexPoint[], from: DayKey, to: DayKey): IndexPoint[] {
  const dates = series.map((p) => p.date);
  let iBase = lastIndexOnOrBefore(dates, addDays(from, -1));
  if (iBase < 0) iBase = 0;
  const base = series[iBase]?.value;
  if (!base) return [];
  return series.filter((p) => p.date >= from && p.date <= to).map((p) => ({ date: p.date, value: (100 * p.value) / base }));
}

/** "114,5% do CDI": só faz sentido quando o benchmark é positivo. */
export const percentOfBenchmark = (rPortfolio: number, rBenchmark: number): number | null =>
  rBenchmark > 0 ? (rPortfolio / rBenchmark) * 100 : null;

/** "IPCA + X% a.a." : retorno real anualizado por dias corridos. */
export function realSpreadAnnualized(rPortfolio: number, rIpca: number, from: DayKey, to: DayKey): number | null {
  const days = daysBetween(from, to);
  if (days <= 0) return null;
  const real = (1 + rPortfolio) / (1 + rIpca) - 1;
  return Math.pow(1 + real, 365 / days) - 1;
}
