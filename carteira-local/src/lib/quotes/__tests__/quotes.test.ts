import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchJson, HttpProviderError } from "../../http.ts";
import { createThrottle } from "../throttle.ts";
import { parseYahooChart, toYahooSymbol } from "../yahoo.ts";
import { brapiRangeFor, parseBrapi } from "../brapi.ts";
import { ProviderChain } from "../chain.ts";
import { expectedLastTradingDay, isFresh } from "../freshness.ts";
import { runIsolated } from "../../services/settle.ts";
import type { QuoteProvider } from "../provider.ts";

/** fetch falso: devolve as respostas em sequência e registra as chamadas. */
function fakeFetch(responses: Response[]) {
  const calls: number[] = [];
  const fn = (async () => { calls.push(Date.now()); return responses[Math.min(calls.length - 1, responses.length - 1)].clone(); }) as unknown as typeof fetch;
  return { fn, calls };
}
const noSleep = () => { const waits: number[] = []; return { sleep: async (ms: number) => { waits.push(ms); }, waits }; };
const txt = (body: string, status = 200, headers: Record<string, string> = {}) => new Response(body, { status, headers });

test("429 em texto puro: faz retry com backoff crescente e depois sucede", async () => {
  const f = fakeFetch([txt("Too Many Requests", 429), txt("Too Many Requests", 429), txt('{"ok":1}')]);
  const s = noSleep();
  const out = await fetchJson<{ ok: number }>("http://x", {}, { fetchFn: f.fn, sleep: s.sleep, random: () => 0.5, baseDelayMs: 1000 });
  assert.equal(out.ok, 1);
  assert.equal(f.calls.length, 3);
  assert.deepEqual(s.waits, [1000, 2000]);
});

test("o erro original (HTTP 200 com texto 'Too Many Requests') vira rate_limit, não erro de JSON", async () => {
  const f = fakeFetch([txt("Too Many Requests ", 200)]);
  await assert.rejects(
    fetchJson("http://x", {}, { fetchFn: f.fn, sleep: noSleep().sleep, retries: 2 }),
    (e: unknown) => e instanceof HttpProviderError && e.kind === "rate_limit" && !/JSON/.test(e.message),
  );
  assert.equal(f.calls.length, 3); // 1 + 2 retries
});

test("Retry-After é respeitado; 404 não faz retry; JSON inválido não faz retry", async () => {
  const f = fakeFetch([txt("slow down", 429, { "retry-after": "5" }), txt("{}")]);
  const s = noSleep();
  await fetchJson("http://x", {}, { fetchFn: f.fn, sleep: s.sleep, random: () => 0.5, baseDelayMs: 100 });
  assert.equal(s.waits[0], 5000);

  const nf = fakeFetch([txt("not found", 404)]);
  await assert.rejects(fetchJson("http://x", {}, { fetchFn: nf.fn, sleep: noSleep().sleep }), /HTTP 404/);
  assert.equal(nf.calls.length, 1);

  const pf = fakeFetch([txt("<html>oops</html>", 200)]);
  await assert.rejects(fetchJson("http://x", {}, { fetchFn: pf.fn, sleep: noSleep().sleep }), /não é JSON/);
  assert.equal(pf.calls.length, 1);
});

test("throttle espaça chamadas sequenciais", async () => {
  let t = 0;
  const waits: number[] = [];
  const throttle = createThrottle(400, () => t, async (ms) => { waits.push(ms); t += ms; });
  await throttle(); await throttle(); await throttle();
  assert.deepEqual(waits, [400, 400]); // a 1ª passa direto
});

test("parse do Yahoo: usa gmtoffset, ignora closes nulos; erro vira exceção", () => {
  const ts = Date.UTC(2025, 2, 5, 13, 0) / 1000; // 10:00 em Brasília
  const pts = parseYahooChart({ chart: { result: [{ timestamp: [ts, ts + 86400, ts + 172800], meta: { gmtoffset: -10800 }, indicators: { quote: [{ close: [36.5, null, 37.1] }] } }], error: null } });
  assert.deepEqual(pts, [{ date: "2025-03-05", close: 36.5 }, { date: "2025-03-07", close: 37.1 }]);
  assert.deepEqual(parseYahooChart({ chart: { result: null, error: null } }), []);
  assert.throws(() => parseYahooChart({ chart: { result: null, error: { code: "Not Found", description: "No data found" } } }), /No data found/);
  assert.equal(toYahooSymbol("petr4f"), "PETR4.SA");
});

test("parse do BRAPI e escolha de range", () => {
  const ts = Date.UTC(2025, 2, 5, 13, 0) / 1000;
  assert.deepEqual(parseBrapi({ results: [{ historicalDataPrice: [{ date: ts, close: 10 }, { date: ts + 86400, close: null }] }] }), [{ date: "2025-03-05", close: 10 }]);
  assert.throws(() => parseBrapi({ error: true, message: "token inválido" }), /token inválido/);
  assert.equal(brapiRangeFor("2026-11-01", "2026-11-21"), "1mo");
  assert.equal(brapiRangeFor("2024-01-01", "2026-11-21"), "5y");
});

const rateLimited = (name: string): QuoteProvider & { calls: number } => {
  const p = { name, calls: 0, isConfigured: () => true, async fetchHistory() { p.calls++; throw new HttpProviderError("Too Many Requests (rate limit)", "rate_limit", 429, true); } };
  return p;
};
const working = (name: string, empty = false): QuoteProvider & { calls: number } => {
  const p = { name, calls: 0, isConfigured: () => true, async fetchHistory() { p.calls++; return empty ? [] : [{ date: "2026-11-19", close: 1 }]; } };
  return p;
};

test("chain: fallback para o 2º provedor e circuit breaker no 1º após 3 rate limits seguidos", async () => {
  const y = rateLimited("yahoo"), b = working("brapi");
  const chain = new ProviderChain([y, b], 3);
  const ref = { kind: "equity", ticker: "PETR4" } as const;
  for (let i = 0; i < 5; i++) assert.equal((await chain.fetchHistory(ref, "2026-11-01", "2026-11-20")).provider, "brapi");
  assert.equal(y.calls, 3);   // parou de tentar o Yahoo depois de 3
  assert.equal(b.calls, 5);
  assert.equal(chain.isExhausted(), false);
});

test("chain: sem fallback, esgota e passa a falhar rápido; resultado vazio cai para o próximo", async () => {
  const solo = new ProviderChain([rateLimited("yahoo")], 2);
  const ref = { kind: "ibov" } as const;
  await assert.rejects(solo.fetchHistory(ref, "a", "b"), /Too Many Requests/);
  await assert.rejects(solo.fetchHistory(ref, "a", "b"));
  assert.equal(solo.isExhausted(), true);
  await assert.rejects(solo.fetchHistory(ref, "a", "b"), /pausado/);

  const e = working("yahoo", true), w = working("brapi");
  assert.equal((await new ProviderChain([e, w]).fetchHistory(ref, "a", "b")).provider, "brapi");
});

test("frescor: não rebusca ticker já atualizado até o último pregão", () => {
  assert.equal(expectedLastTradingDay("2026-11-21"), "2026-11-20"); // sábado -> sexta
  assert.equal(expectedLastTradingDay("2026-11-23"), "2026-11-20"); // segunda -> sexta
  assert.equal(isFresh("2026-11-20", "2026-11-21"), true);
  assert.equal(isFresh("2026-11-18", "2026-11-21"), false);
});

test("runIsolated: falha do Ibovespa não aborta CDI/IPCA/Selic", async () => {
  const r = await runIsolated([
    { key: "CDI", run: async () => 1 }, { key: "SELIC", run: async () => 2 }, { key: "IPCA", run: async () => 3 },
    { key: "IBOV", run: async () => { throw new Error("Too Many Requests"); } },
  ]);
  assert.deepEqual(r.map((x) => [x.key, x.ok]), [["CDI", true], ["SELIC", true], ["IPCA", true], ["IBOV", false]]);
});
