import { monthKey, weekdaysInMonth } from "./dates.ts";
import type { DayKey } from "./dates.ts";
import type { BenchmarkPoint, FixedIncomeTerms } from "./types.ts";

/** Taxas diárias (decimais) alinhadas ao calendário. */
export interface RateArrays {
  cdi: Float64Array;
  selic: Float64Array;
  /** IPCA mensal distribuído pró-rata pelos dias úteis do mês de referência */
  ipca: Float64Array;
}

const BD_YEAR = 252;
const annualToDaily = (ratePct: number) => Math.pow(1 + ratePct / 100, 1 / BD_YEAR) - 1;

function carryDaily(calendar: DayKey[], points: BenchmarkPoint[] | undefined): Float64Array {
  const out = new Float64Array(calendar.length);
  if (!points?.length) return out;
  const map = new Map(points.map((p) => [p.date, p.value]));
  let last = 0;
  // valor vigente antes do início do calendário
  const firstDay = calendar[0];
  for (const p of points) if (p.date < firstDay) last = p.value;
  for (let i = 0; i < calendar.length; i++) {
    const v = map.get(calendar[i]);
    if (v !== undefined) last = v;
    out[i] = last / 100;
  }
  return out;
}

function ipcaDaily(calendar: DayKey[], points: BenchmarkPoint[] | undefined): Float64Array {
  const out = new Float64Array(calendar.length);
  if (!points?.length || !calendar.length) return out;
  const byMonth = new Map(points.map((p) => [monthKey(p.date), p.value]));
  const months = [...byMonth.keys()].sort();
  const latestAtOrBefore = (m: string): number | undefined => {
    let found: string | undefined;
    for (const k of months) { if (k <= m) found = k; else break; }
    return found ? byMonth.get(found) : undefined;
  };
  const counts = new Map<string, number>();
  for (const d of calendar) counts.set(monthKey(d), (counts.get(monthKey(d)) ?? 0) + 1);
  const firstM = monthKey(calendar[0]);
  const lastM = monthKey(calendar[calendar.length - 1]);
  const bd = (m: string) => (m > firstM && m < lastM ? counts.get(m)! : weekdaysInMonth(m));
  for (let i = 0; i < calendar.length; i++) {
    const m = monthKey(calendar[i]);
    // mês ainda não divulgado: projeta com o último valor conhecido
    const mval = latestAtOrBefore(m);
    if (mval === undefined) continue;
    out[i] = Math.pow(1 + mval / 100, 1 / bd(m)) - 1;
  }
  return out;
}

export function buildRateArrays(
  calendar: DayKey[],
  b: { cdi?: BenchmarkPoint[]; selic?: BenchmarkPoint[]; ipca?: BenchmarkPoint[] },
): RateArrays {
  return {
    cdi: carryDaily(calendar, b.cdi),
    selic: carryDaily(calendar, b.selic),
    ipca: ipcaDaily(calendar, b.ipca),
  };
}

/** Índice acumulado (base 1 no primeiro dia do calendário) de uma taxa diária. */
export function cumulativeIndex(daily: Float64Array): Float64Array {
  const idx = new Float64Array(daily.length);
  if (!daily.length) return idx;
  idx[0] = 1;
  for (let i = 1; i < daily.length; i++) idx[i] = idx[i - 1] * (1 + daily[i]);
  return idx;
}

/**
 * Índice de acumulação (base 1 no 1º dia do calendário) da renda fixa na curva.
 * Valor de um lote comprado no dia j, no dia i: principal × idx[i] / idx[j]
 * (o dia da compra não rende; rende a partir do dia útil seguinte).
 * Após o vencimento o índice para de crescer. IR e IOF não são deduzidos (rentabilidade bruta).
 */
export function buildFixedIncomeIndex(
  terms: FixedIncomeTerms,
  calendar: DayKey[],
  rates: RateArrays,
): Float64Array {
  const n = calendar.length;
  const idx = new Float64Array(n);
  if (!n) return idx;
  idx[0] = 1;
  const spreadDaily = annualToDaily(terms.rate);
  for (let i = 1; i < n; i++) {
    let f: number;
    if (terms.maturityDate && calendar[i] > terms.maturityDate) {
      f = 0;
    } else {
      switch (terms.indexer) {
        case "CDI_PERCENT": f = rates.cdi[i] * (terms.rate / 100); break;
        case "CDI_SPREAD": f = (1 + rates.cdi[i]) * (1 + spreadDaily) - 1; break;
        case "IPCA_SPREAD": f = (1 + rates.ipca[i]) * (1 + spreadDaily) - 1; break;
        case "PREFIXADO": f = spreadDaily; break;
        case "SELIC": f = (1 + rates.selic[i]) * (1 + spreadDaily) - 1; break;
      }
    }
    idx[i] = idx[i - 1] * (1 + f);
  }
  return idx;
}
