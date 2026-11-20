import { prisma } from "../db/prisma";
import { computePortfolio } from "../finance/portfolio";
import { fromDayKey, toDayKey } from "../finance/dates";
import type { EngineInput } from "../finance/types";
import type { Indexer, TransactionType } from "../finance/constants";

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

async function loadBenchmark(code: string) {
  const b = await prisma.benchmark.findUnique({ where: { code } });
  if (!b) return [];
  const rows = await prisma.benchmarkValue.findMany({ where: { benchmarkId: b.id }, orderBy: { date: "asc" } });
  return rows.map((r) => ({ date: toDayKey(r.date), value: r.value }));
}

export async function loadEngineInput(endDate = toDayKey(new Date())): Promise<EngineInput> {
  const [assets, txs, provs, quotes, cdi, selic, ipca] = await Promise.all([
    prisma.asset.findMany({ include: { fixedIncome: true } }),
    prisma.transaction.findMany({ orderBy: { tradeDate: "asc" } }),
    prisma.provento.findMany({ orderBy: { paymentDate: "asc" } }),
    prisma.priceQuote.findMany({ orderBy: { date: "asc" } }),
    loadBenchmark("CDI"), loadBenchmark("SELIC"), loadBenchmark("IPCA"),
  ]);
  const q: EngineInput["quotes"] = {};
  for (const r of quotes) (q[r.assetId] ??= []).push({ date: toDayKey(r.date), close: r.close });
  return {
    assets: assets.map((a) => ({
      id: a.id, ticker: a.ticker, assetClass: a.assetClass,
      fixedIncome: a.fixedIncome
        ? { indexer: a.fixedIncome.indexer as Indexer, rate: a.fixedIncome.rate, maturityDate: toDayKey(a.fixedIncome.maturityDate) }
        : null,
    })),
    transactions: txs.map((t) => ({
      assetId: t.assetId, type: t.type as TransactionType, date: toDayKey(t.tradeDate),
      quantity: t.quantity, unitPrice: t.unitPrice, fees: t.fees, taxes: t.taxes, factor: t.factor,
    })),
    proventos: provs.map((p) => ({ assetId: p.assetId, paymentDate: toDayKey(p.paymentDate), netAmount: p.netAmount })),
    quotes: q,
    benchmarks: { cdi, selic, ipca },
    endDate,
  };
}

/** Recalcula e regrava PortfolioSnapshot e PositionSnapshot (cache derivado). */
export async function rebuildSnapshots(endDate?: string) {
  const result = computePortfolio(await loadEngineInput(endDate));
  await prisma.$transaction([prisma.portfolioSnapshot.deleteMany(), prisma.positionSnapshot.deleteMany()]);
  for (const part of chunk(result.portfolio, 500)) {
    await prisma.portfolioSnapshot.createMany({
      data: part.map((p) => ({
        date: fromDayKey(p.date), marketValue: p.marketValue, provCash: p.provCash, totalValue: p.totalValue,
        netFlow: p.netFlow, investedCost: p.investedCost, dailyReturn: p.dailyReturn, quota: p.quota,
      })),
    });
  }
  for (const part of chunk(result.positions, 500)) {
    await prisma.positionSnapshot.createMany({
      data: part.map((p) => ({
        assetId: p.assetId, date: fromDayKey(p.date), quantity: p.quantity,
        averagePrice: p.averagePrice, price: p.price, marketValue: p.marketValue,
      })),
    });
  }
  return { days: result.portfolio.length, positions: result.positions.length, warnings: result.warnings, last: result.portfolio.at(-1) ?? null };
}
