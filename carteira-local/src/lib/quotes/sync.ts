import { prisma } from "../db/prisma";
import { addDays, fromDayKey, toDayKey } from "../finance/dates";
import { fetchYahooHistory, toYahooSymbol } from "./yahoo";

const LISTED = ["ACAO", "FII", "ETF", "BDR"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Cotações de Ações/FIIs/ETFs/BDRs via Yahoo. Incremental; `full` re-busca todo o histórico. */
export async function syncQuotes(opts: { full?: boolean; tickers?: string[] } = {}) {
  const assets = await prisma.asset.findMany({
    where: { assetClass: { in: LISTED }, isActive: true, ...(opts.tickers ? { ticker: { in: opts.tickers } } : {}) },
    include: { transactions: { orderBy: { tradeDate: "asc" }, take: 1 } },
  });
  const to = addDays(toDayKey(new Date()), 1);
  const report: { ticker: string; fetched: number; error?: string }[] = [];
  for (const a of assets) {
    try {
      if (!a.transactions.length) { report.push({ ticker: a.ticker, fetched: 0 }); continue; }
      let from = addDays(toDayKey(a.transactions[0].tradeDate), -7);
      if (!opts.full) {
        const last = await prisma.priceQuote.findFirst({ where: { assetId: a.id }, orderBy: { date: "desc" } });
        if (last) from = addDays(toDayKey(last.date), -3);
      }
      const hist = await fetchYahooHistory(toYahooSymbol(a.ticker), fromDayKey(from), fromDayKey(to));
      await prisma.$transaction([
        prisma.priceQuote.deleteMany({ where: { assetId: a.id, date: { gte: fromDayKey(from) } } }),
        prisma.priceQuote.createMany({ data: hist.map((h) => ({ assetId: a.id, date: fromDayKey(h.date), close: h.close, source: "PROVIDER:yahoo" })) }),
      ]);
      report.push({ ticker: a.ticker, fetched: hist.length });
    } catch (e) {
      report.push({ ticker: a.ticker, fetched: 0, error: e instanceof Error ? e.message : String(e) });
    }
    await sleep(300);
  }
  return report;
}

/** Ibovespa (^BVSP) em BenchmarkValue como nível do índice. */
export async function syncIbovespa(opts: { since?: string; full?: boolean } = {}) {
  const bench = await prisma.benchmark.upsert({
    where: { code: "IBOV" },
    update: {},
    create: { code: "IBOV", name: "Ibovespa (pontos)", sgsCode: null, valueKind: "INDEX_LEVEL" },
  });
  let from = opts.since ?? "2018-01-01";
  if (!opts.full && !opts.since) {
    const last = await prisma.benchmarkValue.findFirst({ where: { benchmarkId: bench.id }, orderBy: { date: "desc" } });
    if (last) from = addDays(toDayKey(last.date), -3);
  }
  const hist = await fetchYahooHistory("^BVSP", fromDayKey(from), fromDayKey(addDays(toDayKey(new Date()), 1)));
  await prisma.$transaction([
    prisma.benchmarkValue.deleteMany({ where: { benchmarkId: bench.id, date: { gte: fromDayKey(from) } } }),
    prisma.benchmarkValue.createMany({ data: hist.map((h) => ({ benchmarkId: bench.id, date: fromDayKey(h.date), value: h.close })) }),
    prisma.benchmark.update({ where: { id: bench.id }, data: { lastSyncAt: new Date() } }),
  ]);
  return { from, fetched: hist.length };
}
