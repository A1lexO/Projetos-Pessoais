import { addDays, isWeekday } from "../finance/dates.ts";

/** Último pregão "esperado" já fechado: ontem (ou a sexta anterior, se cair em fim de semana). Feriados não são considerados. */
export function expectedLastTradingDay(today: string): string {
  let d = addDays(today, -1);
  while (!isWeekday(d)) d = addDays(d, -1);
  return d;
}

export const isFresh = (lastDate: string, today: string): boolean => lastDate >= expectedLastTradingDay(today);
