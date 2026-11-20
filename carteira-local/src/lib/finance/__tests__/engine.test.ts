import { test } from "node:test";
import assert from "node:assert/strict";
import { applyTransaction, EMPTY_STATE, averagePrice } from "../average-price.ts";
import { computePortfolio } from "../portfolio.ts";
import { percentOfBenchmark, realSpreadAnnualized, windowReturn } from "../compare.ts";
import { monthlyProventos, trailing12m, yieldOnCost } from "../proventos.ts";
import type { EngineInput, EngineTransaction } from "../types.ts";

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const tx = (o: Partial<EngineTransaction> & Pick<EngineTransaction, "type" | "date" | "quantity" | "unitPrice">): EngineTransaction =>
  ({ assetId: "A", fees: 0, taxes: 0, ...o });

const DAYS = ["2025-01-06", "2025-01-07", "2025-01-08", "2025-01-09", "2025-01-10"]; // seg-sex
const cdiFlat = DAYS.map((date) => ({ date, value: 0.05 }));
const base = (over: Partial<EngineInput>): EngineInput => ({
  assets: [{ id: "A", ticker: "AAAA3", assetClass: "ACAO" }],
  transactions: [], proventos: [], quotes: {}, benchmarks: { cdi: cdiFlat }, endDate: "2025-01-10", ...over,
});

test("preço médio: compras, venda (PM não muda) e desdobramento", () => {
  let s = applyTransaction(EMPTY_STATE, tx({ type: "BUY", date: "2025-01-06", quantity: 100, unitPrice: 10 })).state;
  s = applyTransaction(s, tx({ type: "BUY", date: "2025-01-06", quantity: 100, unitPrice: 20 })).state;
  close(averagePrice(s), 15);
  const sell = applyTransaction(s, tx({ type: "SELL", date: "2025-01-07", quantity: 50, unitPrice: 30 }));
  close(averagePrice(sell.state), 15);
  close(sell.realizedPnL, 750);
  close(sell.flow, -1500);
  const split = applyTransaction(sell.state, tx({ type: "SPLIT", date: "2025-01-08", quantity: 0, unitPrice: 0, factor: 2 }));
  close(split.state.quantity, 300);
  close(averagePrice(split.state), 7.5);
});

test("TWR: aporte não distorce a cota (rentabilidade = variação do preço)", () => {
  const out = computePortfolio(base({
    transactions: [
      tx({ type: "BUY", date: "2025-01-06", quantity: 100, unitPrice: 10 }),
      tx({ type: "BUY", date: "2025-01-08", quantity: 100, unitPrice: 11 }),
    ],
    quotes: { A: [
      { date: "2025-01-06", close: 10 }, { date: "2025-01-07", close: 11 },
      { date: "2025-01-08", close: 11 }, { date: "2025-01-09", close: 12.1 },
    ] },
  }));
  const q = out.portfolio.map((p) => p.quota);
  close(q[0], 100); close(q[1], 110); close(q[2], 110); close(q[3], 121);
  close(out.portfolio[2].netFlow, 1100);
});

test("renda fixa 100% CDI na curva e proventos entram no retorno", () => {
  const cdb = computePortfolio(base({
    assets: [{ id: "A", ticker: "CDB", assetClass: "RENDA_FIXA", fixedIncome: { indexer: "CDI_PERCENT", rate: 100 } }],
    transactions: [tx({ type: "BUY", date: "2025-01-06", quantity: 1, unitPrice: 1000 })],
  }));
  close(cdb.portfolio[4].totalValue, 1000 * Math.pow(1.0005, 4), 1e-6);

  const prov = computePortfolio(base({
    transactions: [tx({ type: "BUY", date: "2025-01-06", quantity: 100, unitPrice: 10 })],
    quotes: { A: DAYS.map((date) => ({ date, close: 10 })) },
    proventos: [{ assetId: "A", paymentDate: "2025-01-07", netAmount: 50 }],
  }));
  close(prov.portfolio[1].dailyReturn, 0.05);
});

test("prefixado e IPCA+ acumulam pelo calendário", () => {
  const pre = computePortfolio(base({
    assets: [{ id: "A", ticker: "PRE", assetClass: "RENDA_FIXA", fixedIncome: { indexer: "PREFIXADO", rate: 10 } }],
    transactions: [tx({ type: "BUY", date: "2025-01-06", quantity: 1, unitPrice: 1000 })],
  }));
  close(pre.portfolio[4].totalValue, 1000 * Math.pow(1.1, 4 / 252), 1e-6);

  const ipca = computePortfolio(base({
    assets: [{ id: "A", ticker: "NTNB", assetClass: "TESOURO", fixedIncome: { indexer: "IPCA_SPREAD", rate: 6 } }],
    transactions: [tx({ type: "BUY", date: "2025-01-06", quantity: 1, unitPrice: 1000 })],
    benchmarks: { cdi: cdiFlat, ipca: [{ date: "2025-01-01", value: 0.5 }] },
  }));
  const v = ipca.portfolio[4].totalValue;
  assert.ok(v > 1000 && v < 1005, `valor inesperado ${v}`);
});

test("desdobramento: cotações ajustadas casam com livro normalizado", () => {
  const out = computePortfolio(base({
    transactions: [
      tx({ type: "BUY", date: "2025-01-06", quantity: 100, unitPrice: 20 }),
      tx({ type: "SPLIT", date: "2025-01-08", quantity: 0, unitPrice: 0, factor: 2 }),
    ],
    quotes: { A: [{ date: "2025-01-06", close: 10 }, { date: "2025-01-07", close: 10.5 }, { date: "2025-01-08", close: 11 }] },
  }));
  close(out.portfolio[0].totalValue, 2000); // 200 × 10
  close(out.portfolio[0].quota, 100);
  close(out.portfolio[2].quota, 110);
});

test("comparação com benchmarks e proventos", () => {
  close(percentOfBenchmark(0.124, 0.108)!, 114.8148148148, 1e-6);
  assert.equal(percentOfBenchmark(0.05, -0.01), null);
  close(realSpreadAnnualized(0.1, 0.04, "2025-01-01", "2026-01-01")!, 1.1 / 1.04 - 1, 1e-9);
  const s = [{ date: "2025-01-06", value: 100 }, { date: "2025-01-07", value: 110 }, { date: "2025-01-08", value: 121 }];
  close(windowReturn(s, "2025-01-07", "2025-01-08")!, 0.21);
  const pv = [
    { assetId: "A", paymentDate: "2025-01-10", netAmount: 100 },
    { assetId: "A", paymentDate: "2025-02-10", netAmount: 50 },
    { assetId: "A", paymentDate: "2025-02-20", netAmount: 25 },
  ];
  const m = monthlyProventos(pv);
  close(m[1].total, 75); close(m[1].cumulative, 175);
  close(yieldOnCost(trailing12m(pv, "2025-03-01"), 1750), 0.1);
});
