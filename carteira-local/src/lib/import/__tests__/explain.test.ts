import { test } from "node:test";
import assert from "node:assert/strict";
import { explainRows } from "../explain.ts";

const MOV = (o: Record<string, unknown>) => ({
  "Entrada/Saída": "Credito", "Data": "10/03/2026", "Movimentação": "Direitos de Subscrição",
  "Produto": "KNSC11 - KENAZ FII", "Instituição": "X", "Quantidade": 36, "Preço unitário": "-", "Valor da Operação": "-", ...o,
});

test("explica linhas de um ticker: eventos sem regra aparecem como SEM REGRA; resumo soma créditos e débitos", () => {
  const r = explainRows([
    MOV({}),
    MOV({ "Movimentação": "Rendimento", "Valor da Operação": "R$ 40,00" }),
    MOV({ "Movimentação": "Transferência - Liquidação", "Entrada/Saída": "Debito", "Quantidade": 10 }),
    MOV({ "Produto": "VALE3 - VALE" }),
  ], ["knsc11"]);
  assert.equal(r.lines.length, 3);
  assert.match(r.lines[0].handling, /SEM REGRA/);
  assert.match(r.lines[1].handling, /provento RENDIMENTO/);
  assert.match(r.lines[2].handling, /Negociação/);
  assert.equal(r.summary.find((s) => /Liquidação/.test(s.movement))!.debit, 10);
});

test("Negociação: compras e vendas por ticker", () => {
  const NEG = (o: Record<string, unknown>) => ({ "Data do Negócio": "05/03/2026", "Tipo de Movimentação": "Compra", "Mercado": "Mercado à Vista", "Instituição": "X", "Código de Negociação": "CASH3", "Quantidade": 100, "Preço": "R$ 5,00", "Valor": "R$ 500,00", ...o });
  const r = explainRows([NEG({}), NEG({ "Tipo de Movimentação": "Venda", "Quantidade": 40 }), NEG({ "Código de Negociação": "VALE3" })], ["CASH3"]);
  assert.equal(r.kind, "B3_NEGOCIACAO");
  assert.deepEqual([r.summary[0].credit, r.summary[1].debit], [100, 40]);
});
