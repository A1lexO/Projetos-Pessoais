import { prisma } from "../db/prisma";
import { percentOfBenchmark, realSpreadAnnualized, rebase, toIndexSeries, windowReturn, windowStart } from "../finance/compare";
import type { IndexPoint, WindowKey } from "../finance/compare";
import { addMonths, daysBetween, fromDayKey, monthKey, toDayKey } from "../finance/dates";
import { buildRateArrays, cumulativeIndex } from "../finance/fixed-income";
import { fractionalPart, LISTED_CLASSES, staleQuoteHints, suggestConversions } from "../finance/corporate";
import type { PositionLite } from "../finance/corporate";
import { yieldOnCost } from "../finance/proventos";
import { brl, num, TYPE_LABELS } from "../format";
import { loadBenchmark } from "./snapshots";

export const WINDOWS: WindowKey[] = ["1M", "6M", "YTD", "12M", "ALL"];
export const WINDOW_LABELS: Record<WindowKey, string> = { "1M": "1M", "6M": "6M", YTD: "YTD", "12M": "12M", ALL: "Tudo" };

// ---------------------------------------------------------------------------
// Dashboard
// Patrimônio = posições + proventos recebidos (caixa). Valor aplicado = aportes líquidos de resgates.
// Lucro = Patrimônio − Valor aplicado (inclui realizado, não realizado e proventos).
// ---------------------------------------------------------------------------
export async function getDashboard(window: WindowKey) {
  const snaps = await prisma.portfolioSnapshot.findMany({ orderBy: { date: "asc" } });
  if (!snaps.length) return null;
  const calendar = snaps.map((s) => toDayKey(s.date));
  const first = calendar[0];
  const end = calendar[calendar.length - 1];
  const [cdi, ipca, ibovPts] = await Promise.all([loadBenchmark("CDI"), loadBenchmark("IPCA"), loadBenchmark("IBOV")]);
  const rates = buildRateArrays(calendar, { cdi, ipca });

  let start = windowStart(window, end, first);
  const clamped = start < first;
  if (clamped) start = first;

  const cart: IndexPoint[] = snaps.map((s) => ({ date: toDayKey(s.date), value: s.quota }));
  const cdiS = toIndexSeries(calendar, cumulativeIndex(rates.cdi));
  const ipcaS = toIndexSeries(calendar, cumulativeIndex(rates.ipca));
  let ibovS: IndexPoint[] | null = null;
  if (ibovPts.length) {
    let j = 0;
    let last = ibovPts[0].value;
    ibovS = calendar.map((date) => {
      while (j < ibovPts.length && ibovPts[j].date <= date) last = ibovPts[j++].value;
      return { date, value: last };
    });
  }

  const rCart = windowReturn(cart, start, end);
  const rCdi = windowReturn(cdiS, start, end);
  const rIpca = windowReturn(ipcaS, start, end);
  const rIbov = ibovS ? windowReturn(ibovS, start, end) : null;
  const days = daysBetween(start, end);

  const rc = rebase(cart, start, end);
  const rcdi = rebase(cdiS, start, end);
  const ripca = rebase(ipcaS, start, end);
  const ribov = ibovS ? rebase(ibovS, start, end) : null;
  const chart = rc.map((p, i) => ({
    date: p.date, carteira: p.value - 100, cdi: (rcdi[i]?.value ?? 100) - 100, ipca: (ripca[i]?.value ?? 100) - 100,
    ibov: ribov ? (ribov[i]?.value ?? 100) - 100 : null,
  }));

  const last = snaps[snaps.length - 1];
  const aplicado = snaps.reduce((a, s) => a + s.netFlow, 0);
  const month = monthKey(end);
  const [provMonth, provTotal, positions] = await Promise.all([
    prisma.provento.aggregate({ _sum: { netAmount: true }, where: { paymentDate: { gte: fromDayKey(`${month}-01`), lt: fromDayKey(addMonths(`${month}-01`, 1)) } } }),
    prisma.provento.aggregate({ _sum: { netAmount: true } }),
    prisma.positionSnapshot.findMany({ where: { date: last.date }, include: { asset: true } }),
  ]);
  const byClass = new Map<string, number>();
  for (const p of positions) byClass.set(p.asset.assetClass, (byClass.get(p.asset.assetClass) ?? 0) + p.marketValue);

  return {
    window, start, end, clamped, days,
    kpis: {
      patrimonio: last.totalValue, posicoes: last.marketValue, provCaixa: last.provCash,
      aplicado, lucro: last.totalValue - aplicado, lucroPct: aplicado > 0 ? (last.totalValue - aplicado) / aplicado : null,
      provMes: provMonth._sum.netAmount ?? 0, provTotal: provTotal._sum.netAmount ?? 0, mesRef: month,
    },
    returns: {
      carteira: rCart, cdi: rCdi, ipca: rIpca, ibov: rIbov,
      pctCdi: rCart != null && rCdi != null ? percentOfBenchmark(rCart, rCdi) : null,
      ipcaPlus: rCart != null && rIpca != null && days >= 60 ? realSpreadAnnualized(rCart, rIpca, start, end) : null,
    },
    chart, hasIbov: !!ribov,
    allocation: [...byClass.entries()].map(([assetClass, value]) => ({ assetClass, value })).sort((a, b) => b.value - a.value),
  };
}

// ---------------------------------------------------------------------------
// Meus Ativos
// ---------------------------------------------------------------------------
export async function getAssetsTable(assetClass?: string) {
  const last = await prisma.portfolioSnapshot.findFirst({ orderBy: { date: "desc" } });
  if (!last) return null;
  const end = toDayKey(last.date);
  const [positions, provs] = await Promise.all([
    prisma.positionSnapshot.findMany({ where: { date: last.date }, include: { asset: true } }),
    prisma.provento.groupBy({
      by: ["assetId"], _sum: { netAmount: true },
      where: { paymentDate: { gt: fromDayKey(addMonths(end, -12)), lte: last.date } },
    }),
  ]);
  const prov12 = new Map(provs.map((p) => [p.assetId, p._sum.netAmount ?? 0]));
  const totalMv = positions.reduce((a, p) => a + p.marketValue, 0);
  const all = positions.map((p) => {
    const cost = p.quantity * p.averagePrice;
    return {
      ticker: p.asset.ticker, name: p.asset.name, assetClass: p.asset.assetClass,
      quantity: p.quantity, averagePrice: p.averagePrice, price: p.price, marketValue: p.marketValue,
      pnlValue: p.marketValue - cost, pnlPct: cost > 0 ? p.marketValue / cost - 1 : null,
      weight: totalMv > 0 ? p.marketValue / totalMv : 0,
      yoc: yieldOnCost(prov12.get(p.assetId) ?? 0, cost),
      fraction: LISTED_CLASSES.includes(p.asset.assetClass) ? fractionalPart(p.quantity) : 0,
    };
  }).sort((a, b) => b.marketValue - a.marketValue);
  const classes = [...new Set(all.map((r) => r.assetClass))].map((c) => ({ assetClass: c, count: all.filter((r) => r.assetClass === c).length }));
  const rows = assetClass ? all.filter((r) => r.assetClass === assetClass) : all;
  const totals = {
    marketValue: rows.reduce((a, r) => a + r.marketValue, 0),
    pnlValue: rows.reduce((a, r) => a + r.pnlValue, 0),
    cost: rows.reduce((a, r) => a + (r.marketValue - r.pnlValue), 0),
    weight: rows.reduce((a, r) => a + r.weight, 0),
  };
  return { date: end, rows, classes, totals, totalCount: all.length };
}

// ---------------------------------------------------------------------------
// Lançamentos
// ---------------------------------------------------------------------------
export const PAGE_SIZE = 25;

export async function getHistory(opts: { tab: "operacoes" | "proventos"; q?: string; page: number }) {
  const skip = (opts.page - 1) * PAGE_SIZE;
  const asset = opts.q ? { ticker: { contains: opts.q.trim().toUpperCase() } } : undefined;
  if (opts.tab === "proventos") {
    const where = asset ? { asset } : {};
    const [rows, count] = await Promise.all([
      prisma.provento.findMany({ where, orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }], skip, take: PAGE_SIZE, include: { asset: true } }),
      prisma.provento.count({ where }),
    ]);
    return {
      count,
      rows: rows.map((r) => ({ id: r.id, date: toDayKey(r.paymentDate), ticker: r.asset.ticker, type: r.type, quantity: r.quantity, unitPrice: null as number | null, amount: r.netAmount, source: r.source, factor: null as number | null, counterpart: null as string | null, fees: 0 })),
    };
  }
  const where = asset ? { asset } : {};
  const [rows, count] = await Promise.all([
    prisma.transaction.findMany({ where, orderBy: [{ tradeDate: "desc" }, { createdAt: "desc" }], skip, take: PAGE_SIZE, include: { asset: true, counterpart: true } }),
    prisma.transaction.count({ where }),
  ]);
  return {
    count,
    rows: rows.map((r) => ({ id: r.id, date: toDayKey(r.tradeDate), ticker: r.asset.ticker, type: r.type, quantity: r.quantity, unitPrice: r.unitPrice, amount: r.quantity * r.unitPrice, source: r.source, factor: r.factor, counterpart: r.counterpart?.ticker ?? null, fees: r.fees })),
  };
}

export async function getRecentBatches() {
  const rows = await prisma.importBatch.findMany({ orderBy: { createdAt: "desc" }, take: 8 });
  return rows.map((b) => ({ id: b.id, fileName: b.fileName, fileKind: b.fileKind, imported: b.rowsImported, skipped: b.rowsSkipped, failed: b.rowsFailed, createdAt: b.createdAt.toISOString().slice(0, 16).replace("T", " ") }));
}

// ---------------------------------------------------------------------------
// Conferência de posições (eventos corporativos pendentes)
// ---------------------------------------------------------------------------
export async function getReconcile() {
  const last = await prisma.portfolioSnapshot.findFirst({ orderBy: { date: "desc" } });
  if (!last) return null;
  const [positions, assets, quotes] = await Promise.all([
    prisma.positionSnapshot.findMany({ where: { date: last.date }, include: { asset: true } }),
    prisma.asset.findMany({ select: { ticker: true } }),
    prisma.priceQuote.groupBy({ by: ["assetId"], _max: { date: true } }),
  ]);
  const lastQuote = new Map(quotes.map((q) => [q.assetId, q._max.date ? toDayKey(q._max.date) : null]));
  const lite: PositionLite[] = positions.map((p) => ({
    ticker: p.asset.ticker, assetClass: p.asset.assetClass, quantity: p.quantity, lastQuoteDate: lastQuote.get(p.assetId) ?? null,
  }));
  const conversions = suggestConversions(lite, assets.map((a) => a.ticker));
  const fractions = positions
    .filter((p) => LISTED_CLASSES.includes(p.asset.assetClass) && fractionalPart(p.quantity) > 0)
    .map((p) => ({ ticker: p.asset.ticker, quantity: p.quantity, fraction: fractionalPart(p.quantity), price: p.price }));
  const stale = staleQuoteHints(lite, toDayKey(new Date())).filter((h) => !conversions.some((c) => c.from === h.ticker));
  return {
    date: toDayKey(last.date), fractions, conversions, stale,
    total: fractions.length + conversions.length + stale.length,
  };
}

/** Posição do sistema por ticker (inclui ativos inativos que ainda tenham saldo). */
export async function getSystemPositions() {
  const last = await prisma.portfolioSnapshot.findFirst({ orderBy: { date: "desc" } });
  if (!last) return [];
  const rows = await prisma.positionSnapshot.findMany({ where: { date: last.date }, include: { asset: true } });
  return rows.map((r) => ({ ticker: r.asset.ticker, quantity: r.quantity }));
}

// ---------------------------------------------------------------------------
// Extrato por ativo: evolução da posição (inclui entradas/saídas por troca de ticker) e os lançamentos de cada mudança
// ---------------------------------------------------------------------------
export async function getAssetLedger(ticker: string) {
  const asset = await prisma.asset.findUnique({ where: { ticker } });
  if (!asset) return null;
  const [positions, txs, lastSnap] = await Promise.all([
    prisma.positionSnapshot.findMany({ where: { assetId: asset.id }, orderBy: { date: "asc" } }),
    prisma.transaction.findMany({
      where: { OR: [{ assetId: asset.id }, { counterpartAssetId: asset.id }] },
      orderBy: { tradeDate: "asc" }, include: { asset: true, counterpart: true },
    }),
    prisma.portfolioSnapshot.findFirst({ orderBy: { date: "desc" } }),
  ]);
  const describe = (t: (typeof txs)[number]) => {
    if (t.counterpartAssetId === asset.id) return `Entrada por troca de ${t.asset.ticker} ×${num(t.factor ?? 1, 6)}`;
    if (t.type === "TRANSFER_OUT") return `Saída por troca → ${t.counterpart?.ticker ?? "?"} ×${num(t.factor ?? 1, 6)}`;
    if (t.type === "COST_REDUCTION") return `Redução de custo de ${brl(t.quantity * t.unitPrice)}`;
    if (t.type === "REGROUP") return `Grupamento: posição passa a ${num(t.quantity, 6)}`;
    if (t.type === "SPLIT") return t.factor ? `Desdobramento ×${num(t.factor, 6)}` : `Desdobro: +${num(t.quantity, 6)} (custo mantido, PM diminui)`;
    if (t.type === "REVERSE_SPLIT") return t.factor ? `Grupamento ×${num(t.factor, 6)}` : `Grupamento: −${num(t.quantity, 6)}`;
    if (t.type === "FRACTION_WRITEOFF") return `Baixa de fração ${num(t.quantity, 6)}${t.unitPrice ? ` (recebido ${brl(t.quantity * t.unitPrice)})` : ""}`;
    return `${TYPE_LABELS[t.type] ?? t.type} ${num(t.quantity, 6)}${t.unitPrice ? ` a ${brl(t.unitPrice)}` : ""}`;
  };
  const rows: { date: string; quantity: number; delta: number; averagePrice: number; events: string[] }[] = [];
  let prevQty = 0, prevAvg = 0, prevDate = "";
  for (const p of positions) {
    const date = toDayKey(p.date);
    if (Math.abs(p.quantity - prevQty) > 1e-9 || Math.abs(p.averagePrice - prevAvg) > 1e-9) {
      rows.push({ date, quantity: p.quantity, delta: p.quantity - prevQty, averagePrice: p.averagePrice,
        events: txs.filter((t) => { const d = toDayKey(t.tradeDate); return d > prevDate && d <= date; }).map(describe) });
    }
    prevQty = p.quantity; prevAvg = p.averagePrice; prevDate = date;
  }
  if (positions.length && lastSnap && positions[positions.length - 1].date < lastSnap.date) { // posição zerada depois
    rows.push({ date: "zerada", quantity: 0, delta: -prevQty, averagePrice: 0, events: txs.filter((t) => toDayKey(t.tradeDate) > prevDate).map(describe) });
  }
  const ignored = lastSnap ? txs.filter((t) => t.tradeDate > lastSnap.date && toDayKey(t.tradeDate) > toDayKey(new Date())).map(describe) : [];
  return { ticker: asset.ticker, isActive: asset.isActive, assetClass: asset.assetClass, rows, ignored, txCount: txs.length };
}
