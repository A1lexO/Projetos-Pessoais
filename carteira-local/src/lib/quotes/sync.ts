import { planSeriesReplace } from "../benchmarks/series-merge";
import { prisma } from "../db/prisma";
import { addDays, fromDayKey, toDayKey } from "../finance/dates";
import { createDefaultChain } from "./chain";
import type { ProviderChain } from "./chain";
import { isFresh } from "./freshness";

const LISTED = ["ACAO", "FII", "ETF", "BDR"];

export interface QuoteSyncItem {
  ticker: string;
  status: "ok" | "fresh" | "error" | "skipped";
  fetched: number;
  provider?: string;
  message?: string;
}

/**
 * Cotações de Ações/FIIs/ETFs/BDRs. SEQUENCIAL (1 ticker por vez, com intervalo entre chamadas),
 * incremental (pula quem já está atualizado) e com fallback de provedor. `full` re-busca tudo.
 * Uma falha em um ticker nunca interrompe os demais.
 */
export async function syncQuotes(opts: { full?: boolean; tickers?: string[]; chain?: ProviderChain } = {}): Promise<QuoteSyncItem[]> {
  const chain = opts.chain ?? createDefaultChain();
  const today = toDayKey(new Date());
  const assets = await prisma.asset.findMany({
    where: { assetClass: { in: LISTED }, isActive: true, ...(opts.tickers ? { ticker: { in: opts.tickers } } : {}) },
    include: { transactions: { orderBy: { tradeDate: "asc" }, take: 1 } },
    orderBy: { ticker: "asc" },
  });
  const report: QuoteSyncItem[] = [];
  for (const a of assets) {
    if (!a.transactions.length) { report.push({ ticker: a.ticker, status: "skipped", fetched: 0, message: "sem operações" }); continue; }
    if (chain.isExhausted()) {
      report.push({ ticker: a.ticker, status: "skipped", fetched: 0, message: "provedores pausados por rate limit; tente de novo em alguns minutos" });
      continue;
    }
    try {
      let from = addDays(toDayKey(a.transactions[0].tradeDate), -7);
      if (!opts.full) {
        const last = await prisma.priceQuote.findFirst({ where: { assetId: a.id }, orderBy: { date: "desc" } });
        if (last) {
          const lastKey = toDayKey(last.date);
          if (isFresh(lastKey, today)) { report.push({ ticker: a.ticker, status: "fresh", fetched: 0, message: `atualizado até ${lastKey}` }); continue; }
          from = addDays(lastKey, -3);
        }
      }
      const { provider, points } = await chain.fetchHistory({ kind: "equity", ticker: a.ticker }, from, today);
      const plan = planSeriesReplace(from, points.map((p) => ({ date: p.date, value: p.close })));
      if (!plan.rows.length) throw new Error("provedor não devolveu cotações");
      await prisma.$transaction([
        prisma.priceQuote.deleteMany({ where: { assetId: a.id, date: { gte: fromDayKey(plan.deleteFrom) } } }),
        prisma.priceQuote.createMany({ data: plan.rows.map((h) => ({ assetId: a.id, date: fromDayKey(h.date), close: h.value, source: `PROVIDER:${provider}` })) }),
      ]);
      report.push({ ticker: a.ticker, status: "ok", fetched: plan.rows.length, provider });
    } catch (e) {
      report.push({ ticker: a.ticker, status: "error", fetched: 0, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return report;
}

/** Ibovespa (^BVSP) em BenchmarkValue (nível do índice). Lança erro se todos os provedores falharem. */
export async function syncIbovespa(opts: { since?: string; full?: boolean; chain?: ProviderChain } = {}) {
  const chain = opts.chain ?? createDefaultChain();
  const today = toDayKey(new Date());
  const bench = await prisma.benchmark.upsert({
    where: { code: "IBOV" }, update: {},
    create: { code: "IBOV", name: "Ibovespa (pontos)", sgsCode: null, valueKind: "INDEX_LEVEL" },
  });
  let from = opts.since ?? "2018-01-01";
  if (!opts.full && !opts.since) {
    const last = await prisma.benchmarkValue.findFirst({ where: { benchmarkId: bench.id }, orderBy: { date: "desc" } });
    if (last) {
      const lastKey = toDayKey(last.date);
      if (isFresh(lastKey, today)) return { from: lastKey, fetched: 0, fresh: true as const, provider: undefined };
      from = addDays(lastKey, -3);
    }
  }
  const { provider, points } = await chain.fetchHistory({ kind: "ibov" }, from, today);
  const plan = planSeriesReplace(from, points.map((p) => ({ date: p.date, value: p.close })));
  if (!plan.rows.length) throw new Error("provedor não devolveu dados do Ibovespa");
  await prisma.$transaction([
    prisma.benchmarkValue.deleteMany({ where: { benchmarkId: bench.id, date: { gte: fromDayKey(plan.deleteFrom) } } }),
    prisma.benchmarkValue.createMany({ data: plan.rows.map((h) => ({ benchmarkId: bench.id, date: fromDayKey(h.date), value: h.value })) }),
    prisma.benchmark.update({ where: { id: bench.id }, data: { lastSyncAt: new Date() } }),
  ]);
  return { from, fetched: plan.rows.length, fresh: false as const, provider };
}
