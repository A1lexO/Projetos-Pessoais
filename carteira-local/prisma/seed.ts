// Carteira fictícia completa para testar cálculos e gráficos (dados INVENTADOS).
// uso: npx prisma migrate dev  &&  npx prisma db seed
// Se o banco já tem ativos, aborta; para recriar tudo: SEED_FORCE=1 npx prisma db seed
import { prisma } from "../src/lib/db/prisma";
import { fromDayKey, toDayKey, addDays } from "../src/lib/finance/dates";
import { rebuildSnapshots } from "../src/lib/services/snapshots";
import { generateSeedData } from "./seed-data";

const chunk = <T,>(a: T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));

async function main() {
  if ((await prisma.asset.count()) > 0 && !process.env.SEED_FORCE) {
    console.error("Banco já possui ativos. Use SEED_FORCE=1 para apagar tudo e recriar com dados fictícios.");
    process.exit(1);
  }
  const end = addDays(toDayKey(new Date()), -1);
  const data = generateSeedData(end);

  await prisma.$transaction([
    prisma.positionSnapshot.deleteMany(), prisma.portfolioSnapshot.deleteMany(),
    prisma.provento.deleteMany(), prisma.transaction.deleteMany(), prisma.priceQuote.deleteMany(),
    prisma.benchmarkValue.deleteMany(), prisma.benchmark.deleteMany(),
    prisma.fixedIncomeTerms.deleteMany(), prisma.asset.deleteMany(), prisma.importBatch.deleteMany(),
  ]);

  const ids = new Map<string, string>();
  for (const a of data.assets) {
    const row = await prisma.asset.create({
      data: {
        ticker: a.ticker, name: a.name, assetClass: a.assetClass,
        fixedIncome: a.fixedIncome
          ? { create: { indexer: a.fixedIncome.indexer, rate: a.fixedIncome.rate, maturityDate: fromDayKey(a.fixedIncome.maturityDate), issuer: a.fixedIncome.issuer } }
          : undefined,
      },
    });
    ids.set(a.ticker, row.id);
  }

  await prisma.transaction.createMany({
    data: data.transactions.map((t) => ({
      assetId: ids.get(t.ticker)!, type: t.type, tradeDate: fromDayKey(t.date),
      quantity: t.quantity, unitPrice: t.unitPrice, factor: t.factor ?? null, source: "MANUAL", notes: "seed",
    })),
  });
  await prisma.provento.createMany({
    data: data.proventos.map((p) => ({
      assetId: ids.get(p.ticker)!, type: p.type, paymentDate: fromDayKey(p.paymentDate), comDate: fromDayKey(p.comDate),
      quantity: p.quantity, grossAmount: p.gross, taxWithheld: p.tax, netAmount: Math.round((p.gross - p.tax) * 100) / 100, source: "MANUAL",
    })),
  });
  for (const [ticker, pts] of Object.entries(data.quotes)) {
    for (const part of chunk(pts, 500)) {
      await prisma.priceQuote.createMany({
        data: part.map((p) => ({ assetId: ids.get(ticker)!, date: fromDayKey(p.date), close: p.close, source: "SEED" })),
      });
    }
  }
  const defs = [
    { code: "CDI", name: "CDI (taxa diária, % a.d.)", sgsCode: 12, valueKind: "DAILY_RATE", pts: data.benchmarks.cdi },
    { code: "SELIC", name: "Selic (taxa diária, % a.d.)", sgsCode: 11, valueKind: "DAILY_RATE", pts: data.benchmarks.selic },
    { code: "IPCA", name: "IPCA (variação mensal, %)", sgsCode: 433, valueKind: "MONTHLY_RATE", pts: data.benchmarks.ipca },
    { code: "IBOV", name: "Ibovespa (pontos)", sgsCode: null, valueKind: "INDEX_LEVEL", pts: data.benchmarks.ibov },
  ];
  for (const d of defs) {
    const b = await prisma.benchmark.create({ data: { code: d.code, name: d.name, sgsCode: d.sgsCode, valueKind: d.valueKind, lastSyncAt: new Date() } });
    for (const part of chunk(d.pts, 500)) {
      await prisma.benchmarkValue.createMany({ data: part.map((p) => ({ benchmarkId: b.id, date: fromDayKey(p.date), value: p.value })) });
    }
  }

  const r = await rebuildSnapshots(end);
  console.log(`Seed ok: ${data.assets.length} ativos, ${data.transactions.length} operações, ${data.proventos.length} proventos.`);
  console.log("Snapshots:", { dias: r.days, posicoes: r.positions, ultimo: r.last });
  console.log("ATENÇÃO: CDI/IPCA/IBOV e cotações são SINTÉTICOS. Antes de usar dados reais, rode `npx prisma migrate reset` e depois os syncs.");
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
