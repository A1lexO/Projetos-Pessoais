import yahooFinance from "yahoo-finance2";

export interface HistoryPoint { date: string; close: number }

/** PETR4 -> PETR4.SA ; PETR4F (fracionário) -> PETR4.SA */
export function toYahooSymbol(ticker: string): string {
  const t = ticker.trim().toUpperCase();
  const frac = t.match(/^([A-Z]{4}\d{1,2})F$/);
  return `${frac ? frac[1] : t}.SA`;
}

/** Histórico diário de fechamento. `close` do Yahoo vem ajustado por desdobramentos (não por dividendos). */
export async function fetchYahooHistory(symbol: string, from: Date, to: Date): Promise<HistoryPoint[]> {
  const res = await yahooFinance.chart(symbol, { period1: from, period2: to, interval: "1d" });
  const out: HistoryPoint[] = [];
  for (const q of res.quotes ?? []) {
    if (q.close == null || !Number.isFinite(q.close)) continue;
    out.push({ date: new Date(q.date).toISOString().slice(0, 10), close: q.close });
  }
  return out;
}
