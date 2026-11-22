import { fetchJson, HttpProviderError } from "../http.ts";
import type { RetryOptions } from "../http.ts";
import type { HistoryPoint, QuoteProvider, SecurityRef } from "./provider.ts";

// BRAPI (brapi.dev): fallback opcional, ativo só se BRAPI_TOKEN estiver definido.
// ATENÇÃO: formato baseado na documentação pública; valide com seu token. Os limites do plano
// (histórico disponível, nº de tickers) são definidos pela BRAPI.
const BASE = "https://brapi.dev/api/quote";

export function brapiRangeFor(from: string, today: string): string {
  const days = Math.ceil((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
  if (days <= 30) return "1mo";
  if (days <= 90) return "3mo";
  if (days <= 180) return "6mo";
  if (days <= 365) return "1y";
  if (days <= 730) return "2y";
  if (days <= 1825) return "5y";
  if (days <= 3650) return "10y";
  return "max";
}

export function parseBrapi(json: unknown): HistoryPoint[] {
  const j = json as { error?: boolean | string; message?: string; results?: { historicalDataPrice?: { date: number; close: number | null }[] }[] };
  if (j?.error) throw new HttpProviderError(`BRAPI: ${j.message ?? String(j.error)}`, "http", null, false);
  const rows = j?.results?.[0]?.historicalDataPrice ?? [];
  const out: HistoryPoint[] = [];
  for (const r of rows) {
    if (r.close == null || !Number.isFinite(r.close)) continue;
    out.push({ date: new Date((r.date - 3 * 3600) * 1000).toISOString().slice(0, 10), close: r.close }); // UTC-3 (Brasil)
  }
  return out;
}

export function createBrapiProvider(opts: { token?: string; retry?: RetryOptions; throttle?: () => Promise<void>; today?: () => string } = {}): QuoteProvider {
  return {
    name: "brapi",
    isConfigured: () => !!opts.token,
    async fetchHistory(ref: SecurityRef, from: string, to: string) {
      const symbol = ref.kind === "ibov" ? "^BVSP" : ref.ticker.replace(/^([A-Z][A-Z0-9]{2}[A-Z]\d{1,2})F$/, "$1");
      await opts.throttle?.();
      const range = brapiRangeFor(from, (opts.today ?? (() => new Date().toISOString().slice(0, 10)))());
      const json = await fetchJson(`${BASE}/${encodeURIComponent(symbol)}?range=${range}&interval=1d&token=${encodeURIComponent(opts.token ?? "")}`, {}, opts.retry);
      return parseBrapi(json).filter((p) => p.date >= from && p.date <= to);
    },
  };
}
