import { test } from "node:test";
import assert from "node:assert/strict";
import { parseB3Rows } from "../b3-parser.ts";
import { hashParts } from "../parse-utils.ts";

const MOV = (o: Record<string, unknown>) => ({
  "Entrada/Saída": "Credito", "Data": "20/03/2025", "Movimentação": "Desdobramento",
  "Produto": "WEGE3 - WEG S.A.", "Instituição": "CORRETORA X", "Quantidade": 100, "Preço unitário": "-", "Valor da Operação": "-", ...o,
});
const skippedTotal = (r: ReturnType<typeof parseB3Rows>) => Object.values(r.skipped).reduce((a, b) => a + b, 0);

test("desdobramento só com crédito mantém EXATAMENTE o externalId antigo (reimportar não duplica)", () => {
  const r = parseB3Rows([MOV({})]);
  assert.equal(r.transactions[0].type, "SPLIT");
  assert.equal(r.transactions[0].externalId, hashParts(["B3_MOVIMENTACAO", "2025-03-20", "WEGE3", "SPLIT", 100, 0]));
});

test("grupamento com débito e crédito vira REVERSE_SPLIT com fator explícito", () => {
  const r = parseB3Rows([
    MOV({ "Movimentação": "Grupamento", "Entrada/Saída": "Debito", "Quantidade": 1000 }),
    MOV({ "Movimentação": "Grupamento", "Entrada/Saída": "Credito", "Quantidade": 100 }),
  ]);
  assert.equal(r.transactions.length, 1);
  const t = r.transactions[0];
  assert.equal(t.type, "REVERSE_SPLIT");
  assert.equal(t.factor, 0.1);
  assert.equal(t.quantity, 900);
  assert.ok(r.alerts.some((a) => /grupamento/.test(a)));
});

test("desdobramento com débito e crédito usa fator = créditos ÷ débitos; crédito = débito não gera nada", () => {
  const split = parseB3Rows([MOV({ "Entrada/Saída": "Debito", "Quantidade": 100 }), MOV({ "Quantidade": 300 })]);
  assert.equal(split.transactions[0].type, "SPLIT");
  assert.equal(split.transactions[0].factor, 3);
  const none = parseB3Rows([MOV({ "Movimentação": "Atualização", "Entrada/Saída": "Debito" }), MOV({ "Movimentação": "Atualização" })]);
  assert.equal(none.transactions.length, 0);
  assert.equal(skippedTotal(none), 2);
});

test("atualização e grupamento só com crédito/débito NÃO são aplicados (evita corromper saldo)", () => {
  const r = parseB3Rows([MOV({ "Movimentação": "Atualização" }), MOV({ "Movimentação": "Grupamento", "Produto": "ITUB4 - ITAU", "Entrada/Saída": "Debito" })]);
  assert.equal(r.transactions.length, 0);
  assert.equal(skippedTotal(r), 2);
});

test("incorporação/troca de ticker (PETZ3→AUAU3): TRANSFER_OUT com razão", () => {
  const r = parseB3Rows([
    MOV({ "Movimentação": "Incorporação", "Produto": "PETZ3 - PET CENTER", "Entrada/Saída": "Debito", "Quantidade": 800 }),
    MOV({ "Movimentação": "Incorporação", "Produto": "AUAU3 - PET CENTER COMERCIO", "Entrada/Saída": "Credito", "Quantidade": 800 }),
  ]);
  assert.equal(r.transactions.length, 1);
  const t = r.transactions[0];
  assert.deepEqual([t.type, t.ticker, t.counterpartTicker, t.quantity, t.factor], ["TRANSFER_OUT", "PETZ3", "AUAU3", 800, 1]);
  assert.ok(r.alerts.some((a) => /PETZ3 → AUAU3/.test(a)));
  // reimportar gera o mesmo id
  assert.equal(parseB3Rows([
    MOV({ "Movimentação": "Incorporação", "Produto": "PETZ3 - PET CENTER", "Entrada/Saída": "Debito", "Quantidade": 800 }),
    MOV({ "Movimentação": "Incorporação", "Produto": "AUAU3 - X", "Entrada/Saída": "Credito", "Quantidade": 800 }),
  ]).transactions[0].externalId, t.externalId);
});

test("troca ambígua ou sem contrapartida vai para lançamento manual, sem inventar posição", () => {
  const amb = parseB3Rows([
    MOV({ "Movimentação": "Fusão", "Produto": "AAAA3 - A", "Entrada/Saída": "Debito" }),
    MOV({ "Movimentação": "Fusão", "Produto": "BBBB3 - B", "Entrada/Saída": "Debito" }),
    MOV({ "Movimentação": "Fusão", "Produto": "CCCC3 - C", "Entrada/Saída": "Credito" }),
  ]);
  assert.equal(amb.transactions.length, 0);
  assert.equal(amb.issues[0].level, "warn");
  const alone = parseB3Rows([MOV({ "Movimentação": "Incorporação", "Produto": "AAAA3 - A" })]);
  assert.equal(alone.transactions.length, 0);
  assert.equal(skippedTotal(alone), 1);
});

test("recibo de subscrição creditado vira compra; conversão recibo→principal vira TRANSFER_OUT", () => {
  const buy = parseB3Rows([MOV({ "Movimentação": "Recibo de Subscrição", "Produto": "KNSC12 - KENAZ FII", "Quantidade": 36, "Preço unitário": "R$ 9,50", "Valor da Operação": "R$ 342,00" })]);
  assert.deepEqual([buy.transactions[0].type, buy.transactions[0].ticker, buy.transactions[0].unitPrice], ["BUY", "KNSC12", 9.5]);
  const conv = parseB3Rows([
    MOV({ "Movimentação": "Recibo de Subscrição", "Produto": "KNSC12 - KENAZ FII", "Entrada/Saída": "Debito", "Quantidade": 36 }),
    MOV({ "Movimentação": "Recibo de Subscrição", "Produto": "KNSC11 - KENAZ FII", "Entrada/Saída": "Credito", "Quantidade": 36 }),
  ]);
  assert.deepEqual([conv.transactions[0].type, conv.transactions[0].ticker, conv.transactions[0].counterpartTicker], ["TRANSFER_OUT", "KNSC12", "KNSC11"]);
});

test("leilão de fração (débito) vira FRACTION_WRITEOFF com valor recebido; crédito de fração vira BONUS custo zero", () => {
  const r = parseB3Rows([
    MOV({ "Movimentação": "Fração em Ativos", "Produto": "KLBN11 - KLABIN", "Quantidade": "0,8" }),
    MOV({ "Movimentação": "Leilão de Fração", "Produto": "KLBN11 - KLABIN", "Entrada/Saída": "Debito", "Quantidade": "0,8", "Preço unitário": "R$ 6,25", "Valor da Operação": "R$ 5,00" }),
  ]);
  assert.deepEqual(r.transactions.map((t) => [t.type, t.quantity, t.unitPrice]), [["BONUS", 0.8, 0], ["FRACTION_WRITEOFF", 0.8, 6.25]]);
});
