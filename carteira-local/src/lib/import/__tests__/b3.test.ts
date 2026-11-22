import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDate, parseNumber } from "../parse-utils.ts";
import { classifyTicker, normalizeTicker } from "../classify.ts";
import { detectKind, parseB3Rows } from "../b3-parser.ts";

const NEG = (o: Record<string, unknown>) => ({
  "Data do Negócio": "05/03/2025", "Tipo de Movimentação": "Compra", "Mercado": "Mercado à Vista",
  "Prazo/Vencimento": "-", "Instituição": "CORRETORA X", "Código de Negociação": "PETR4",
  "Quantidade": 100, "Preço": "R$ 36,50", "Valor": "R$ 3.650,00", ...o,
});
const MOV = (o: Record<string, unknown>) => ({
  "Entrada/Saída": "Credito", "Data": "14/03/2025", "Movimentação": "Rendimento",
  "Produto": "HGLG11 - CSHG LOGISTICA FDO INV IMOB - FII", "Instituição": "CORRETORA X",
  "Quantidade": 10, "Preço unitário": "-", "Valor da Operação": "R$ 11,00", ...o,
});

test("números e datas no formato da B3", () => {
  assert.equal(parseNumber("R$ 1.234,56"), 1234.56);
  assert.equal(parseNumber("-"), null);
  assert.equal(parseNumber(12.5), 12.5);
  assert.equal(parseNumber("100"), 100);
  assert.equal(parseDate("05/03/2025"), "2025-03-05");
  assert.equal(parseDate("31/02/2025"), null);
  assert.equal(parseDate(45658), "2025-01-01");
  assert.equal(parseDate("2025-03-05"), "2025-03-05");
});

test("classificação e tickers fracionários", () => {
  assert.equal(normalizeTicker("petr4f"), "PETR4");
  assert.equal(classifyTicker("PETR4").assetClass, "ACAO");
  assert.equal(classifyTicker("BOVA11").assetClass, "ETF");
  assert.equal(classifyTicker("AAPL34").assetClass, "BDR");
  assert.equal(classifyTicker("HGLG11", "HGLG11 - CSHG LOGISTICA FDO INV IMOB - FII").assetClass, "FII");
  assert.equal(classifyTicker("TAEE11").assetClass, "ACAO");
  assert.equal(classifyTicker("XPTO11").confident, false);
});

test("Negociação: detecta layout, mapeia e gera externalId estável e único", () => {
  const rows = [NEG({}), NEG({}), NEG({ "Tipo de Movimentação": "Venda", "Quantidade": 50, "Código de Negociação": "PETR4F" }),
    NEG({ "Mercado": "Opções de Compra" }), NEG({ "Código de Negociação": "CDB123" })];
  assert.equal(detectKind(Object.keys(rows[0])), "B3_NEGOCIACAO");
  const a = parseB3Rows(rows);
  assert.equal(a.transactions.length, 3);
  assert.equal(a.transactions[0].unitPrice, 36.5);
  assert.equal(a.transactions[2].type, "SELL");
  assert.equal(a.transactions[2].ticker, "PETR4");
  assert.notEqual(a.transactions[0].externalId, a.transactions[1].externalId); // linhas idênticas legítimas
  assert.equal(Object.values(a.skipped).reduce((x, y) => x + y, 0), 2);
  const b = parseB3Rows(rows); // reimportar o mesmo arquivo
  assert.deepEqual(a.transactions.map((t) => t.externalId), b.transactions.map((t) => t.externalId));
});

test("Movimentação: proventos, desdobramento; negócios e renda fixa ignorados", () => {
  const rows = [
    MOV({}),
    MOV({ "Movimentação": "Juros Sobre Capital Próprio", "Produto": "ITUB4 - ITAU UNIBANCO HOLDING S.A.", "Valor da Operação": 85 }),
    MOV({ "Movimentação": "Desdobramento", "Produto": "WEGE3 - WEG S.A.", "Quantidade": 100, "Valor da Operação": "-" }),
    MOV({ "Movimentação": "Transferência - Liquidação", "Entrada/Saída": "Debito" }),
    MOV({ "Produto": "Tesouro IPCA+ 2035" }),
    MOV({ "Movimentação": "Grupamento" }),
  ];
  assert.equal(detectKind(Object.keys(rows[0])), "B3_MOVIMENTACAO");
  const r = parseB3Rows(rows);
  assert.equal(r.proventos.length, 2);
  assert.equal(r.proventos[0].type, "RENDIMENTO");
  assert.equal(r.proventos[0].assetClass, "FII");
  assert.equal(r.proventos[1].type, "JCP");
  assert.equal(r.transactions.length, 2);
  assert.equal(r.transactions[0].type, "SPLIT");
  assert.equal(r.transactions[1].type, "REGROUP"); // "Grupamento" só com crédito = posição final (caso CASH3)
  assert.equal(Object.values(r.skipped).reduce((x, y) => x + y, 0), 2);
});

test("layout desconhecido gera erro explicando as colunas", () => {
  assert.throws(() => parseB3Rows([{ A: 1, B: 2 }]), /Layout não reconhecido/);
});
