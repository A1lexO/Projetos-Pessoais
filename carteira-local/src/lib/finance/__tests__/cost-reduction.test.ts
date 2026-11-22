import { test } from "node:test";
import assert from "node:assert/strict";
import { computePortfolio } from "../portfolio.ts";
import { addDays, isWeekday } from "../dates.ts";
import type { EngineAsset, EngineInput, EngineTransaction } from "../types.ts";
import { TICKER_RE, normalizeTicker, classifyTicker } from "../../import/classify.ts";

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const DAYS: string[] = [];
for (let d = "2025-01-06"; d <= "2025-01-31"; d = addDays(d, 1)) if (isWeekday(d)) DAYS.push(d);
const asset = (id: string, ticker = id): EngineAsset => ({ id, ticker, assetClass: "ACAO" });
const tx = (o: Partial<EngineTransaction> & Pick<EngineTransaction, "assetId" | "type" | "date">): EngineTransaction =>
  ({ quantity: 0, unitPrice: 0, fees: 0, taxes: 0, ...o });
const flat = (from: string, price: number) => DAYS.filter((d) => d >= from).map((date) => ({ date, close: price }));
const run = (over: Partial<EngineInput>) =>
  computePortfolio({ assets: [], transactions: [], proventos: [], quotes: {}, benchmarks: { cdi: DAYS.map((date) => ({ date, value: 0.05 })) }, endDate: "2025-01-31", ...over });
const last = (out: ReturnType<typeof run>, id: string) => out.positions.filter((p) => p.assetId === id).at(-1)!;

test("incorporação com resgate (PETZ3→AUAU3): 800 ações, custo abatido em R$ 568,84, PM cai, valor vai ao caixa sem ser aporte", () => {
  const out = run({
    assets: [asset("P", "PETZ3"), asset("A", "AUAU3")],
    transactions: [
      tx({ assetId: "P", type: "BUY", date: "2025-01-06", quantity: 800, unitPrice: 3080.84 / 800 }),
      tx({ assetId: "P", type: "TRANSFER_OUT", date: "2025-01-08", factor: 1, counterpartAssetId: "A" }),
      tx({ assetId: "A", type: "COST_REDUCTION", date: "2025-01-20", quantity: 800, unitPrice: 568.84 / 800 }),
    ],
    quotes: { A: flat("2025-01-08", 3.2) },
  });
  const a = last(out, "A");
  close(a.quantity, 800);
  close(a.averagePrice, (3080.84 - 568.84) / 800); // 3,14
  close(a.averagePrice, 3.14);
  const day = out.portfolio.find((p) => p.date === "2025-01-20")!;
  close(day.netFlow, 0);                 // não é aporte nem resgate
  close(day.provCash, 568.84);           // fica na carteira como caixa
  close(out.portfolio.at(-1)!.provCash, 568.84);
  assert.deepEqual(out.warnings, []);
});

test("redução maior que o custo zera o custo e o excedente é resultado realizado; sem posição, só avisa", () => {
  const over = run({
    assets: [asset("A")],
    transactions: [
      tx({ assetId: "A", type: "BUY", date: "2025-01-06", quantity: 100, unitPrice: 1 }),
      tx({ assetId: "A", type: "COST_REDUCTION", date: "2025-01-10", quantity: 1, unitPrice: 130 }),
    ],
  });
  close(last(over, "A").averagePrice, 0);
  close(over.realizedPnL.get("A")!, 30);
  close(over.portfolio.at(-1)!.provCash, 130);

  const none = run({ assets: [asset("A")], transactions: [tx({ assetId: "A", type: "COST_REDUCTION", date: "2025-01-10", quantity: 1, unitPrice: 50 })] });
  assert.ok(none.warnings.some((w) => /sem posição/.test(w)));
  close(none.portfolio.at(-1)?.provCash ?? 50, 50);
});

test("compra depois da redução mistura com o novo PM; quantidade nunca muda pela redução", () => {
  const out = run({
    assets: [asset("A")],
    transactions: [
      tx({ assetId: "A", type: "BUY", date: "2025-01-06", quantity: 100, unitPrice: 10 }),
      tx({ assetId: "A", type: "COST_REDUCTION", date: "2025-01-08", quantity: 1, unitPrice: 200 }),
      tx({ assetId: "A", type: "BUY", date: "2025-01-10", quantity: 100, unitPrice: 10 }),
    ],
  });
  close(last(out, "A").quantity, 200);
  close(last(out, "A").averagePrice, (800 + 1000) / 200);
});

test("tickers com dígito: B3SA3, C9BS4, A1MD34 são aceitos; códigos de renda fixa continuam fora", () => {
  for (const t of ["PETR4", "B3SA3", "C9BS4", "A1MD34", "KNSC11", "KNSC12"]) assert.ok(TICKER_RE.test(t), t);
  for (const t of ["CDB123", "TESOURO", "LCI", "ABC", "1ABC3"]) assert.equal(TICKER_RE.test(t), false, t);
  assert.equal(normalizeTicker("b3sa3f"), "B3SA3");
  assert.equal(classifyTicker("A1MD34").assetClass, "BDR");
  assert.equal(classifyTicker("B3SA3").assetClass, "ACAO");
});
