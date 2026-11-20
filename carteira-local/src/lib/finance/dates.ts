// Datas "de negócio" trafegam como strings YYYY-MM-DD (UTC). Ordenam lexicograficamente.
export type DayKey = string;

export const toDayKey = (d: Date): DayKey => d.toISOString().slice(0, 10);
export const fromDayKey = (k: DayKey): Date => new Date(`${k}T00:00:00.000Z`);

export function addDays(k: DayKey, n: number): DayKey {
  const d = fromDayKey(k);
  d.setUTCDate(d.getUTCDate() + n);
  return toDayKey(d);
}

export function addMonths(k: DayKey, n: number): DayKey {
  const d = fromDayKey(k);
  d.setUTCMonth(d.getUTCMonth() + n);
  return toDayKey(d);
}

export function isWeekday(k: DayKey): boolean {
  const w = fromDayKey(k).getUTCDay();
  return w !== 0 && w !== 6;
}

export const monthKey = (k: DayKey): string => k.slice(0, 7);

export function daysBetween(a: DayKey, b: DayKey): number {
  return Math.round((fromDayKey(b).getTime() - fromDayKey(a).getTime()) / 86_400_000);
}

export function weekdaysInMonth(month: string): number {
  let n = 0;
  let d = `${month}-01`;
  while (monthKey(d) === month) {
    if (isWeekday(d)) n++;
    d = addDays(d, 1);
  }
  return n;
}

/**
 * Calendário de dias úteis da carteira.
 * - Dentro do intervalo coberto pela série do CDI, só entram dias que existem na série
 *   (isso exclui feriados bancários automaticamente).
 * - Fora desse intervalo (antes/depois), entram todos os dias de semana.
 */
export function buildCalendar(start: DayKey, end: DayKey, cdiDays: Iterable<DayKey>): DayKey[] {
  const set = new Set(cdiDays);
  let first = "", last = "";
  for (const d of set) {
    if (!first || d < first) first = d;
    if (!last || d > last) last = d;
  }
  const out: DayKey[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (!isWeekday(d)) continue;
    if (first && d >= first && d <= last && !set.has(d)) continue;
    out.push(d);
  }
  return out;
}

/** Índice do primeiro dia do calendário >= key; -1 se key está além do fim. */
export function nextIndexOnOrAfter(calendar: DayKey[], key: DayKey): number {
  let lo = 0, hi = calendar.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (calendar[mid] < key) lo = mid + 1; else hi = mid;
  }
  return lo < calendar.length ? lo : -1;
}

/** Índice do último dia do calendário <= key; -1 se key é anterior ao início. */
export function lastIndexOnOrBefore(calendar: DayKey[], key: DayKey): number {
  let lo = 0, hi = calendar.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (calendar[mid] <= key) lo = mid + 1; else hi = mid;
  }
  return lo - 1;
}
