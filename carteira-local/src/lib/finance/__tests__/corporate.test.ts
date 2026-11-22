import { test } from "node:test";
import assert from "node:assert/strict";
import { computePortfolio } from "../portfolio.ts";
import { fractionalPart, staleQuoteHints, suggestConversions } from "../corporate.ts";
import { addDays, isWeekday } from "../dates.ts";
import type { EngineAsset, EngineInput, EngineTransaction, PositionPoint } from "../types.ts";

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const DAYS: string[] = [];
for (let d = "2025-01-06"; d <= "2025-01-31"; d = addDays(d, 1)) if (isWeekday(d)) DAYS.push(d);
const cdi = DAYS.map((date) => ({ date, value: 0.05 }));
const asset = (id: string, ticker = id): EngineAsset => ({ id, ticker, assetClass: "ACAO" });
const tx = (o: Partial<EngineTransaction> & Pick<EngineTransaction, "assetId" | "type" | "date">): EngineTransaction =>
  ({ quantity: 0, unitPrice: 0, fees: 0, taxes: 0, ...o });
const flat = (from: string, to: string, price: number) => DAYS.filter((d) => d >= from && d <= to).map((date) => ({ date, close: price }));
const run = (over: Partial<EngineInput>) =>
  computePortfolio({ assets: [], transactions: [], proventos: [], quotes: {}, benchmarks: { cdi }, endDate: "2025-01-31", ...over });
const at = (pts: PositionPoint[], id: string, date: string) => pts.find((p) => p.assetId === id && p.date === date);
const last = (pts: PositionPoint[], id: string) => pts.filter((p) => p.assetId === id).at(-1);

test("troca de ticker/incorporação (PETZ3→AUAU3): posição e custo migram; sem fluxo; origem zera", () => {
  const out = run({
    assets: [asset("P", "PETZ3"), asset("A", "AUAU3")],
    transactions: [
      tx({ assetId: "P", type: "BUY", date: "2025-01-06", quantity: 800, unitPrice: 10 }),
      tx({ assetId: "P", type: "TRANSFER_OUT", date: "2025-01-15", quantity: 0, factor: 1, counterpartAssetId: "A" }),
      tx({ assetId: "A", type: "BUY", date: "2025-01-20", quantity: 100, unitPrice: 12 }),
    ],
    quotes: { P: flat("2025-01-06", "2025-01-14", 10), A: flat("2025-01-15", "2025-01-31", 11) },
  });
  const a = last(out.positions, "A")!;
  close(a.quantity, 900);
  close(a.averagePrice, 9200 / 900);
  assert.equal(out.positions.some((p) => p.assetId === "P" && p.date >= "2025-01-15"), false);
  assert.equal(at(out.positions, "P", "2025-01-14")!.quantity, 800);
  close(at(out.positions, "A", "2025-01-15")!.quantity, 800);
  close(out.portfolio.find((p) => p.date === "2025-01-15")!.netFlow, 0);
  close(out.portfolio.find((p) => p.date === "2025-01-20")!.netFlow, 1200);
  assert.deepEqual(out.warnings, []);
});

test("troca com razão (1→2) e transferência parcial", () => {
  const ratio = run({
    assets: [asset("P"), asset("A")],
    transactions: [
      tx({ assetId: "P", type: "BUY", date: "2025-01-06", quantity: 100, unitPrice: 10 }),
      tx({ assetId: "P", type: "TRANSFER_OUT", date: "2025-01-10", factor: 2, counterpartAssetId: "A" }),
    ],
    quotes: { A: flat("2025-01-10", "2025-01-31", 5) },
  });
  close(last(ratio.positions, "A")!.quantity, 200);
  close(last(ratio.positions, "A")!.averagePrice, 5); // custo total 1000 / 200

  const partial = run({
    assets: [asset("P"), asset("A")],
    transactions: [
      tx({ assetId: "P", type: "BUY", date: "2025-01-06", quantity: 100, unitPrice: 10 }),
      tx({ assetId: "P", type: "TRANSFER_OUT", date: "2025-01-10", quantity: 40, factor: 1, counterpartAssetId: "A" }),
    ],
    quotes: { P: flat("2025-01-06", "2025-01-31", 10), A: flat("2025-01-10", "2025-01-31", 10) },
  });
  close(last(partial.positions, "P")!.quantity, 60);
  close(last(partial.positions, "A")!.quantity, 40);
});

test("conversão de recibo (KNSC12→KNSC11): 414 + 36 = 450 com custo somado", () => {
  const out = run({
    assets: [asset("K11", "KNSC11"), asset("K12", "KNSC12")],
    transactions: [
      tx({ assetId: "K11", type: "BUY", date: "2025-01-06", quantity: 414, unitPrice: 100 }),
      tx({ assetId: "K12", type: "BUY", date: "2025-01-10", quantity: 36, unitPrice: 90 }),
      tx({ assetId: "K12", type: "TRANSFER_OUT", date: "2025-01-20", factor: 1, counterpartAssetId: "K11" }),
    ],
    quotes: { K11: flat("2025-01-06", "2025-01-31", 100), K12: flat("2025-01-10", "2025-01-19", 90) },
  });
  const k = last(out.positions, "K11")!;
  close(k.quantity, 450);
  close(k.averagePrice, (414 * 100 + 36 * 90) / 450);
  assert.equal(last(out.positions, "K12")!.date, "2025-01-17");
});

test("cadeia A→B→C resolve a ordem mesmo com ativos listados ao contrário", () => {
  const out = run({
    assets: [asset("C"), asset("B"), asset("A")],
    transactions: [
      tx({ assetId: "A", type: "BUY", date: "2025-01-06", quantity: 10, unitPrice: 10 }),
      tx({ assetId: "A", type: "TRANSFER_OUT", date: "2025-01-10", factor: 1, counterpartAssetId: "B" }),
      tx({ assetId: "B", type: "TRANSFER_OUT", date: "2025-01-15", factor: 3, counterpartAssetId: "C" }),
    ],
    quotes: { C: flat("2025-01-15", "2025-01-31", 4) },
  });
  close(last(out.positions, "C")!.quantity, 30);
  close(last(out.positions, "C")!.averagePrice, 100 / 30);
  assert.deepEqual(out.warnings, []);
});

test("troca sem destino válido ou em ciclo gera aviso, não quebra", () => {
  const noDest = run({
    assets: [asset("A")],
    transactions: [
      tx({ assetId: "A", type: "BUY", date: "2025-01-06", quantity: 10, unitPrice: 10 }),
      tx({ assetId: "A", type: "TRANSFER_OUT", date: "2025-01-10", factor: 1, counterpartAssetId: "X" }),
    ],
  });
  assert.ok(noDest.warnings.some((w) => /sem ativo de destino/.test(w)));
  const cycle = run({
    assets: [asset("A"), asset("B")],
    transactions: [
      tx({ assetId: "A", type: "BUY", date: "2025-01-06", quantity: 10, unitPrice: 10 }),
      tx({ assetId: "A", type: "TRANSFER_OUT", date: "2025-01-08", factor: 1, counterpartAssetId: "B" }),
      tx({ assetId: "B", type: "TRANSFER_OUT", date: "2025-01-10", factor: 1, counterpartAssetId: "A" }),
    ],
  });
  assert.ok(cycle.warnings.some((w) => /ciclo/.test(w)));
});

test("desdobramento com fator derivado da quantidade creditada; histórico em termos negociados", () => {
  const out = run({
    assets: [asset("A")],
    transactions: [
      tx({ assetId: "A", type: "BUY", date: "2025-01-06", quantity: 100, unitPrice: 20 }),
      tx({ assetId: "A", type: "SPLIT", date: "2025-01-10", quantity: 100 }), // +100 sobre 100 => fator 2
      tx({ assetId: "A", type: "BUY", date: "2025-01-20", quantity: 50, unitPrice: 11 }),
    ],
    quotes: { A: DAYS.map((date) => ({ date, close: 10 })) }, // ajustada: 10 antes e depois
  });
  close(at(out.positions, "A", "2025-01-06")!.quantity, 100);       // como negociado
  close(at(out.positions, "A", "2025-01-06")!.price, 20);           // 10 ajustado × 2
  close(at(out.positions, "A", "2025-01-06")!.marketValue, 2000);
  close(at(out.positions, "A", "2025-01-10")!.quantity, 200);
  close(at(out.positions, "A", "2025-01-10")!.marketValue, 2000);   // sem salto no dia do evento
  close(last(out.positions, "A")!.quantity, 250);
  close(out.portfolio.find((p) => p.date === "2025-01-10")!.dailyReturn, 0);
});

test("grupamento (10→1) por fator e por quantidade debitada", () => {
  const byFactor = run({
    assets: [asset("A")],
    transactions: [
      tx({ assetId: "A", type: "BUY", date: "2025-01-06", quantity: 1000, unitPrice: 1 }),
      tx({ assetId: "A", type: "REVERSE_SPLIT", date: "2025-01-10", factor: 0.1 }),
    ],
    quotes: { A: DAYS.map((date) => ({ date, close: date < "2025-01-10" ? 10 : 10 })) }, // ajustada: 1×10
  });
  close(at(byFactor.positions, "A", "2025-01-06")!.price, 1);
  close(at(byFactor.positions, "A", "2025-01-06")!.marketValue, 1000);
  close(last(byFactor.positions, "A")!.quantity, 100);
  close(last(byFactor.positions, "A")!.averagePrice, 10);

  const byQty = run({
    assets: [asset("A")],
    transactions: [
      tx({ assetId: "A", type: "BUY", date: "2025-01-06", quantity: 1000, unitPrice: 1 }),
      tx({ assetId: "A", type: "REVERSE_SPLIT", date: "2025-01-10", quantity: 900 }), // B3 informa -900
    ],
  });
  close(last(byQty.positions, "A")!.quantity, 100);
});

test("desdobramento depois de uma troca de ticker alcança a quantidade transferida", () => {
  const out = run({
    assets: [asset("B", "OLD3"), asset("A", "NEW3")],
    transactions: [
      tx({ assetId: "B", type: "BUY", date: "2025-01-06", quantity: 100, unitPrice: 10 }),
      tx({ assetId: "B", type: "TRANSFER_OUT", date: "2025-01-10", factor: 1, counterpartAssetId: "A" }),
      tx({ assetId: "A", type: "SPLIT", date: "2025-01-15", factor: 2 }),
    ],
    quotes: { A: flat("2025-01-10", "2025-01-31", 5) }, // ajustada (pré-split 10 negociado)
  });
  close(at(out.positions, "A", "2025-01-10")!.marketValue, 1000);
  close(last(out.positions, "A")!.quantity, 200);
  close(last(out.positions, "A")!.averagePrice, 5);
});

test("baixa de fração (KLBN11 900,8 → 900): PM não muda, valor recebido é saída de caixa", () => {
  const out = run({
    assets: [asset("K", "KLBN11")],
    transactions: [
      tx({ assetId: "K", type: "BUY", date: "2025-01-06", quantity: 900, unitPrice: 10 }),
      tx({ assetId: "K", type: "BONUS", date: "2025-01-08", quantity: 0.8, unitPrice: 0 }),
      tx({ assetId: "K", type: "FRACTION_WRITEOFF", date: "2025-01-10", quantity: 0.8, unitPrice: 6.25 }), // R$ 5,00
    ],
    quotes: { K: DAYS.map((date) => ({ date, close: 10 })) },
  });
  close(at(out.positions, "K", "2025-01-09")!.quantity, 900.8);
  const p = at(out.positions, "K", "2025-01-10")!;
  close(p.quantity, 900);
  close(p.averagePrice, 9000 / 900.8);
  close(out.portfolio.find((x) => x.date === "2025-01-10")!.netFlow, -5);
  close(out.realizedPnL.get("K")!, 5 - 0.8 * (9000 / 900.8));
  // sem valor recebido: apenas some a fração
  const zero = run({
    assets: [asset("K", "KLBN11")],
    transactions: [
      tx({ assetId: "K", type: "BUY", date: "2025-01-06", quantity: 900.8, unitPrice: 10 }),
      tx({ assetId: "K", type: "FRACTION_WRITEOFF", date: "2025-01-10", quantity: 0.8, unitPrice: 0 }),
    ],
  });
  close(last(zero.positions, "K")!.quantity, 900);
  close(zero.portfolio.find((x) => x.date === "2025-01-10")!.netFlow, 0);
});

test("auxiliares: fração residual, conversões sugeridas e cotação defasada", () => {
  close(fractionalPart(900.8), 0.8);
  assert.equal(fractionalPart(900), 0);
  assert.equal(fractionalPart(900.9999999), 0);
  assert.equal(fractionalPart(900.0000001), 0);
  const s = suggestConversions(
    [{ ticker: "KNSC12", assetClass: "FII", quantity: 36 }, { ticker: "KNSC11", assetClass: "FII", quantity: 414 }, { ticker: "XPTO13", assetClass: "FII", quantity: 5 }],
    ["KNSC11", "KNSC12", "XPTO13"],
  );
  assert.deepEqual(s.map((x) => [x.from, x.to, x.toExists]), [["KNSC12", "KNSC11", true], ["XPTO13", "XPTO11", false]]);
  const stale = staleQuoteHints(
    [{ ticker: "PETZ3", assetClass: "ACAO", quantity: 800, lastQuoteDate: "2025-06-01" }, { ticker: "VALE3", assetClass: "ACAO", quantity: 10, lastQuoteDate: "2026-11-19" }, { ticker: "BOLD3", assetClass: "ACAO", quantity: 5, lastQuoteDate: null }],
    "2026-11-21",
  );
  assert.deepEqual(stale.map((x) => x.ticker), ["PETZ3", "BOLD3"]);
});

// ---- regressão: lançamentos datados DEPOIS do último dia útil (ex.: sábado "hoje") eram descartados
const SAT = "2025-02-01"; // sábado; o calendário termina na sexta 2025-01-31

test("baixa de fração e troca de ticker datadas em fim de semana após o último pregão valem na posição final", () => {
  const out = run({
    endDate: SAT,
    assets: [asset("R", "RADL3"), asset("P", "PETZ3"), asset("A", "AUAU3")],
    transactions: [
      tx({ assetId: "R", type: "BUY", date: "2025-01-06", quantity: 100.8, unitPrice: 10 }),
      tx({ assetId: "P", type: "BUY", date: "2025-01-06", quantity: 800, unitPrice: 10 }),
      tx({ assetId: "A", type: "BUY", date: "2025-01-07", quantity: 100, unitPrice: 12 }),
      tx({ assetId: "R", type: "FRACTION_WRITEOFF", date: SAT, quantity: 0.8, unitPrice: 0 }),
      tx({ assetId: "P", type: "TRANSFER_OUT", date: SAT, factor: 1, counterpartAssetId: "A" }),
    ],
    quotes: { R: flat("2025-01-06", "2025-01-31", 10), P: flat("2025-01-06", "2025-01-31", 10), A: flat("2025-01-07", "2025-01-31", 11) },
  });
  assert.equal(out.calendar.at(-1), "2025-01-31");
  close(last(out.positions, "R")!.quantity, 100);
  close(last(out.positions, "A")!.quantity, 900);
  assert.equal(last(out.positions, "P")!.date < "2025-01-31", true); // origem zerou no último dia
  assert.deepEqual(out.warnings, []);
});

test("provento com data após o último pregão entra no caixa; data futura (> hoje) é ignorada com aviso", () => {
  const out = run({
    endDate: SAT,
    assets: [asset("A")],
    transactions: [tx({ assetId: "A", type: "BUY", date: "2025-01-06", quantity: 10, unitPrice: 10 }),
      tx({ assetId: "A", type: "BUY", date: "2025-03-01", quantity: 5, unitPrice: 10 })],
    proventos: [{ assetId: "A", paymentDate: SAT, netAmount: 25 }],
    quotes: { A: flat("2025-01-06", "2025-01-31", 10) },
  });
  close(out.portfolio.at(-1)!.provCash, 25);
  close(last(out.positions, "A")!.quantity, 10);
  assert.ok(out.warnings.some((w) => /posterior|futur/i.test(w)));
});

// ---- Etapa 6: desdobro de quantidade, grupamento por crédito, ordem dos eventos no dia
import { isPlausibleSplitFactor } from "../corporate.ts";

test("fator plausível de desdobramento x crédito avulso de quantidade", () => {
  for (const k of [2, 3, 0.5, 0.1, 0.01, 1.5, 1.1, 10, 0.25]) assert.ok(isPlausibleSplitFactor(k), String(k));
  for (const k of [450 / 414, 600 / 564, 1.0869, 1, 136 / 100]) assert.equal(isPlausibleSplitFactor(k), false, String(k));
});

test("Desdobro de 36 cotas (KNSC11 414→450): soma quantidade, mantém o custo, PM cai; cotação NÃO é des-ajustada", () => {
  const out = run({
    assets: [asset("K", "KNSC11")],
    transactions: [
      tx({ assetId: "K", type: "BUY", date: "2025-01-06", quantity: 414, unitPrice: 9 }),
      tx({ assetId: "K", type: "SPLIT", date: "2025-01-15", quantity: 36 }),
    ],
    quotes: { K: flat("2025-01-06", "2025-01-31", 10) },
  });
  const before = at(out.positions, "K", "2025-01-14")!;
  const after = at(out.positions, "K", "2025-01-15")!;
  close(before.price, 10);                       // sem fator de ajuste de preço
  close(after.quantity, 450);
  close(after.averagePrice, (414 * 9) / 450);    // custo total mantido
  close(out.portfolio.find((p) => p.date === "2025-01-15")!.netFlow, 0);
});

test("grupamento informado só por crédito (CASH3 2023): 256 → 2,56 → baixa 0,56 → desdobro +18 = 20, mesmo com os lançamentos fora de ordem", () => {
  const out = run({
    assets: [asset("C", "CASH3")],
    transactions: [
      tx({ assetId: "C", type: "BUY", date: "2025-01-06", quantity: 256, unitPrice: 0.88 }),
      // ordem "errada" de propósito (como a B3 lista): desdobro, fração, grupamento
      tx({ assetId: "C", type: "SPLIT", date: "2025-01-15", quantity: 18 }),
      tx({ assetId: "C", type: "FRACTION_WRITEOFF", date: "2025-01-15", quantity: 0.56, unitPrice: 49.29 / 0.56 }),
      tx({ assetId: "C", type: "REGROUP", date: "2025-01-15", quantity: 2.56 }),
    ],
    // cotação ajustada (net ×10 para trás): 8,8 antes e depois
    quotes: { C: flat("2025-01-06", "2025-01-31", 8.8) },
  });
  const pre = at(out.positions, "C", "2025-01-14")!;
  const post = at(out.positions, "C", "2025-01-15")!;
  close(pre.quantity, 256);
  close(pre.price, 0.88);                          // 8,8 × 0,01 × 10
  close(post.quantity, 20);
  close(post.price, 8.8);
  const day = out.portfolio.find((p) => p.date === "2025-01-15")!;
  close(day.netFlow, -49.29);                      // dinheiro da fração
  assert.ok(Math.abs(day.dailyReturn) < 0.01, `retorno do dia do evento ${day.dailyReturn}`); // sem salto artificial
  assert.deepEqual(out.warnings, []);
});

test("grupamento por crédito incompatível (≥ posição) é ignorado com aviso", () => {
  const out = run({
    assets: [asset("C")],
    transactions: [
      tx({ assetId: "C", type: "BUY", date: "2025-01-06", quantity: 2, unitPrice: 10 }),
      tx({ assetId: "C", type: "REGROUP", date: "2025-01-10", quantity: 5 }),
    ],
  });
  close(last(out.positions, "C")!.quantity, 2);
  assert.ok(out.warnings.some((w) => /grupamento/.test(w)));
});
