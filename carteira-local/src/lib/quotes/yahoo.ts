import { fetchJson, HttpProviderError } from "../http.ts";
import type { RetryOptions } from "../http.ts";
import type { HistoryPoint, QuoteProvider, SecurityRef } from "./provider.ts";

// Endpoint público v8/chart (sem biblioteca). User-Agent de navegador evita bloqueios triviais.
const BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json,text/plain,*/*",
  "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
};

/** PETR4 -> PETR4.SA ; PETR4F (fracionário) -> PETR4.SA */
export function toYahooSymbol(ticker: string): string {
  const t = ticker.trim().toUpperCase();
  const frac = t.match(/^([A-Z][A-Z0-9]{2}[A-Z]\d{1,2})F$/);
  return `${frac ? frac[1] : t}.SA`;
}

/** Converte a resposta do chart em fechamentos diários (data local da bolsa, via gmtoffset). */
export function parseYahooChart(json: unknown): HistoryPoint[] {
  const chart = (json as { chart?: { error?: { code?: string; description?: string } | null; result?: unknown[] | null } })?.chart;
  if (chart?.error) throw new HttpProviderError(`Yahoo: ${chart.error.description ?? chart.error.code ?? "erro"}`, "http", 404, false);
  const r = chart?.result?.[0] as
    | { timestamp?: number[]; meta?: { gmtoffset?: number }; indicators?: { quote?: { close?: (number | null)[] }[] } }
    | undefined;
  if (!r?.timestamp?.length) return [];
  const closes = r.indicators?.quote?.[0]?.close ?? [];
  const offset = r.meta?.gmtoffset ?? 0;
  const out: HistoryPoint[] = [];
  r.timestamp.forEach((ts, i) => {
    const c = closes[i];
    if (c == null || !Number.isFinite(c)) return;
    out.push({ date: new Date((ts + offset) * 1000).toISOString().slice(0, 10), close: c });
  });
  return out;
}

export function createYahooProvider(opts: { retry?: RetryOptions; throttle?: () => Promise<void> } = {}): QuoteProvider {
  return {
    name: "yahoo",
    isConfigured: () => true,
    async fetchHistory(ref: SecurityRef, from: string, to: string) {
      const symbol = ref.kind === "ibov" ? "^BVSP" : toYahooSymbol(ref.ticker);
      const p1 = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000);
      const p2 = Math.floor(Date.parse(`${to}T00:00:00Z`) / 1000) + 86_400;
      await opts.throttle?.();
      const json = await fetchJson(`${BASE}/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d`, { headers: HEADERS }, opts.retry);
      return parseYahooChart(json);
    },
  };
}
