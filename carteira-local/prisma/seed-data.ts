// Gerador PURO (sem Prisma) de uma carteira fictícia e séries sintéticas determinísticas.
// Tudo aqui é inventado para testar cálculos e gráficos. NÃO são dados de mercado reais.
import { addDays, addMonths, isWeekday, monthKey } from "../src/lib/finance/dates.ts";
import type { DayKey } from "../src/lib/finance/dates.ts";

export const SEED_START: DayKey = "2024-03-01";

export interface SeedAsset {
  ticker: string; name: string; assetClass: string;
  fixedIncome?: { indexer: string; rate: number; maturityDate: DayKey; issuer: string };
}
export interface SeedTx { ticker: string; type: string; date: DayKey; quantity: number; unitPrice: number; factor?: number }
export interface SeedProvento { ticker: string; type: string; paymentDate: DayKey; comDate: DayKey; quantity: number; gross: number; tax: number }

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r: () => number) => {
  const z = Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r());
  return Math.max(-3, Math.min(3, z)); // limita choques extremos nos dados sintéticos
};
const round2 = (x: number) => Math.round(x * 100) / 100;

const MARKET = [
  { ticker: "PETR4", name: "Petrobras PN", cls: "ACAO", p0: 36, mu: 0.0003, sigma: 0.017 },
  { ticker: "VALE3", name: "Vale ON", cls: "ACAO", p0: 62, mu: 0.0001, sigma: 0.016 },
  { ticker: "ITUB4", name: "Itaú Unibanco PN", cls: "ACAO", p0: 33, mu: 0.0004, sigma: 0.013 },
  { ticker: "WEGE3", name: "WEG ON", cls: "ACAO", p0: 38, mu: 0.0003, sigma: 0.015 },
  { ticker: "HGLG11", name: "CSHG Logística FII", cls: "FII", p0: 160, mu: 0.0002, sigma: 0.006 },
  { ticker: "MXRF11", name: "Maxi Renda FII", cls: "FII", p0: 10.3, mu: 0.0001, sigma: 0.004 },
  { ticker: "KNRI11", name: "Kinea Renda Imobiliária FII", cls: "FII", p0: 155, mu: 0.0002, sigma: 0.006 },
  { ticker: "BOVA11", name: "iShares Ibovespa ETF", cls: "ETF", p0: 120, mu: 0.0003, sigma: 0.011 },
];
const SPLITS: Record<string, { date: DayKey; k: number }> = { WEGE3: { date: "2025-06-02", k: 2 } };

function nextWeekday(d: DayKey): DayKey { while (!isWeekday(d)) d = addDays(d, 1); return d; }

export function generateSeedData(endDay: DayKey) {
  const rand = mulberry32(20241120);
  const weekdays: DayKey[] = [];
  for (let d = "2024-01-02"; d <= endDay; d = addDays(d, 1)) if (isWeekday(d)) weekdays.push(d);

  // cotações não ajustadas (como negociadas) e ajustadas (como o Yahoo entrega)
  const raw: Record<string, Record<DayKey, number>> = {};
  const adjusted: Record<string, { date: DayKey; close: number }[]> = {};
  for (const m of MARKET) {
    raw[m.ticker] = {}; adjusted[m.ticker] = [];
    let p = m.p0;
    for (const d of weekdays) {
      p = p * Math.exp(m.mu + m.sigma * gauss(rand));
      const sp = SPLITS[m.ticker];
      const traded = sp && d >= sp.date ? p / sp.k : p; // preço negociado cai no desdobramento
      raw[m.ticker][d] = round2(traded);
      adjusted[m.ticker].push({ date: d, close: round2(sp ? p / sp.k : p) }); // ajustada à base atual (como o Yahoo)
    }
  }

  const assets: SeedAsset[] = [
    ...MARKET.map((m) => ({ ticker: m.ticker, name: m.name, assetClass: m.cls })),
    { ticker: "CDB BANCO XYZ 110% CDI 2028", name: "CDB Banco XYZ", assetClass: "RENDA_FIXA",
      fixedIncome: { indexer: "CDI_PERCENT", rate: 110, maturityDate: "2028-03-01", issuer: "Banco XYZ" } },
    { ticker: "TESOURO IPCA+ 2035", name: "Tesouro IPCA+ 2035", assetClass: "TESOURO",
      fixedIncome: { indexer: "IPCA_SPREAD", rate: 6.2, maturityDate: "2035-05-15", issuer: "Tesouro Nacional" } },
  ];

  const txs: SeedTx[] = [];
  const plan: Record<string, { every: number; qty: number }> = {
    PETR4: { every: 1, qty: 100 }, VALE3: { every: 2, qty: 30 }, ITUB4: { every: 1, qty: 100 }, WEGE3: { every: 2, qty: 50 },
    HGLG11: { every: 1, qty: 5 }, MXRF11: { every: 1, qty: 100 }, KNRI11: { every: 2, qty: 4 }, BOVA11: { every: 3, qty: 10 },
  };
  let m = 0;
  for (let ms = SEED_START; ms <= endDay; ms = addMonths(`${monthKey(ms)}-01`, 1), m++) {
    const day = nextWeekday(`${monthKey(ms)}-01`);
    if (day < SEED_START || day > endDay) continue;
    for (const [ticker, pl] of Object.entries(plan)) {
      if (m % pl.every !== 0) continue;
      const price = raw[ticker][day];
      if (price) txs.push({ ticker, type: "BUY", date: day, quantity: pl.qty, unitPrice: price });
    }
  }
  const at = (t: string, d: DayKey) => raw[t][d];
  txs.push({ ticker: "WEGE3", type: "SPLIT", date: SPLITS.WEGE3.date, quantity: 0, unitPrice: 0, factor: SPLITS.WEGE3.k });
  if (endDay >= "2025-09-01") txs.push({ ticker: "PETR4", type: "SELL", date: "2025-09-01", quantity: 150, unitPrice: at("PETR4", "2025-09-01") });
  if (endDay >= "2026-02-02") txs.push({ ticker: "HGLG11", type: "SELL", date: "2026-02-02", quantity: 5, unitPrice: at("HGLG11", "2026-02-02") });
  const cdb = "CDB BANCO XYZ 110% CDI 2028", tn = "TESOURO IPCA+ 2035";
  for (const d of ["2024-03-01", "2024-09-02", "2025-03-03", "2025-09-01", "2026-03-02"]) if (d <= endDay) txs.push({ ticker: cdb, type: "BUY", date: d, quantity: 1, unitPrice: 5000 });
  for (const d of ["2024-04-01", "2025-02-03"]) if (d <= endDay) txs.push({ ticker: tn, type: "BUY", date: d, quantity: 1, unitPrice: 3000 });
  txs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const held = (ticker: string, day: DayKey) => {
    let q = 0;
    for (const t of txs) {
      if (t.ticker !== ticker || t.date > day) continue;
      if (t.type === "BUY") q += t.quantity; else if (t.type === "SELL") q -= t.quantity; else if (t.type === "SPLIT") q *= t.factor!;
    }
    return q;
  };

  const proventos: SeedProvento[] = [];
  const add = (ticker: string, type: string, pay: DayKey, perShare: number, taxRate: number) => {
    const day = nextWeekday(pay);
    if (day < SEED_START || day > endDay) return;
    const q = held(ticker, addDays(day, -10));
    if (q <= 0) return;
    const gross = round2(q * perShare);
    proventos.push({ ticker, type, paymentDate: day, comDate: addDays(day, -10), quantity: q, gross, tax: round2(gross * taxRate) });
  };
  for (let ms = "2024-03-01"; ms <= endDay; ms = addMonths(ms, 1)) {
    const ym = monthKey(ms), mo = Number(ym.slice(5, 7));
    add("HGLG11", "RENDIMENTO", `${ym}-14`, 1.1, 0);
    add("MXRF11", "RENDIMENTO", `${ym}-14`, 0.1, 0);
    add("KNRI11", "RENDIMENTO", `${ym}-14`, 0.85, 0);
    if ([3, 6, 9, 12].includes(mo)) add("PETR4", "DIVIDENDO", `${ym}-20`, 0.8, 0);
    if ([2, 5, 8, 11].includes(mo)) { add("ITUB4", "JCP", `${ym}-28`, 0.35, 0.15); add("WEGE3", "JCP", `${ym}-28`, 0.2, 0.15); }
    if ([3, 9].includes(mo)) add("VALE3", "DIVIDENDO", `${ym}-25`, 1.5, 0);
  }

  // benchmarks sintéticos (ordem de grandeza realista, valores inventados)
  const cdiByYear: Record<string, number> = { "2024": 0.041, "2025": 0.052, "2026": 0.0545 };
  const cdi = weekdays.map((date) => ({ date, value: cdiByYear[date.slice(0, 4)] ?? 0.05 }));
  const selic = cdi.map((p) => ({ ...p }));
  const ipca: { date: DayKey; value: number }[] = [];
  const lastIpcaMonth = monthKey(addMonths(`${monthKey(endDay)}-01`, -1));
  for (let ms = "2024-01-01"; monthKey(ms) <= lastIpcaMonth; ms = addMonths(ms, 1)) ipca.push({ date: ms, value: round2(0.2 + rand() * 0.6) });
  let lvl = 128000;
  const ibov = weekdays.map((date) => { lvl *= Math.exp(0.0003 + 0.011 * gauss(rand)); return { date, value: Math.round(lvl) }; });

  return { assets, transactions: txs, proventos, quotes: adjusted, benchmarks: { cdi, selic, ipca, ibov } };
}
