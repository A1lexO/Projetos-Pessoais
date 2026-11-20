import { addMonths, monthKey } from "./dates.ts";
import type { DayKey } from "./dates.ts";
import type { EngineProvento } from "./types.ts";

export function monthlyProventos(proventos: EngineProvento[]): { month: string; total: number; cumulative: number }[] {
  const m = new Map<string, number>();
  for (const p of proventos) m.set(monthKey(p.paymentDate), (m.get(monthKey(p.paymentDate)) ?? 0) + p.netAmount);
  let acc = 0;
  return [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([month, total]) => {
    acc += total;
    return { month, total, cumulative: acc };
  });
}

/** Proventos líquidos nos 12 meses até asOf (inclusive), opcionalmente de um ativo. */
export function trailing12m(proventos: EngineProvento[], asOf: DayKey, assetId?: string): number {
  const from = addMonths(asOf, -12);
  let sum = 0;
  for (const p of proventos) {
    if (assetId && p.assetId !== assetId) continue;
    if (p.paymentDate > from && p.paymentDate <= asOf) sum += p.netAmount;
  }
  return sum;
}

/** Yield on Cost = proventos 12M / custo da posição. */
export const yieldOnCost = (proventos12m: number, cost: number): number => (cost > 0 ? proventos12m / cost : 0);
