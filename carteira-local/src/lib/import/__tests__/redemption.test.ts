import { test } from "node:test";
import assert from "node:assert/strict";
import { parseB3Rows } from "../b3-parser.ts";
import { resolveCostTargets } from "../resolve.ts";

const MOV = (o: Record<string, unknown>) => ({
  "Entrada/Saída": "Credito", "Data": "06/01/2026", "Movimentação": "Incorporação",
  "Produto": "AUAU3 - PET CENTER COMERCIO E PARTICIPACOES S.A.", "Instituição": "CORRETORA X", "Quantidade": 800, "Preço unitário": "-", "Valor da Operação": "-", ...o,
});
const incorporacao = () => [
  MOV({}),
  MOV({ "Produto": "C9BS3 - COBASI INVESTIMENTOS S.A." }),
  MOV({ "Produto": "C9BS4 - COBASI INVESTIMENTOS S.A." }),
];
const resgate = () => MOV({ "Data": "23/01/2026", "Movimentação": "Resgate", "Produto": "C9BS4 - COBASI INVESTIMENTOS S.A.", "Preço unitário": "R$ 0,711", "Valor da Operação": "R$ 568,84" });

test("caso real: incorporação só com créditos + resgate de C9BS4 => COST_REDUCTION com candidatos do grupo", () => {
  const r = parseB3Rows([...incorporacao(), resgate()]);
  assert.equal(r.transactions.length, 1);
  const t = r.transactions[0];
  assert.equal(t.type, "COST_REDUCTION");
  assert.deepEqual(t.costTargets, ["AUAU3", "C9BS3"]);
  assert.equal(t.quantity, 800);
  assert.ok(Math.abs(t.quantity * t.unitPrice - 568.84) < 1e-9);
  assert.equal(t.date, "2026-01-23");
  assert.ok(r.alerts.some((a) => /abaterá o custo/.test(a)));
  // os 3 créditos da incorporação sem débito continuam sem virar posição (avisados como sem contrapartida)
  assert.equal(Object.keys(r.skipped).some((k) => /incorporação sem contrapartida/.test(k)), true);
  // reimportar: mesmo id
  assert.equal(parseB3Rows([...incorporacao(), resgate()]).transactions[0].externalId, t.externalId);
});

test("o importador escolhe o destino que já existe; sem destino conhecido, descarta com alerta", () => {
  const parsed = parseB3Rows([...incorporacao(), resgate()]).transactions;
  const ok = resolveCostTargets(parsed, new Set(["AUAU3"]));
  assert.equal(ok.txs[0].ticker, "AUAU3");
  assert.equal(ok.txs[0].costTargets, null);
  assert.equal(ok.dropped, 0);
  const none = resolveCostTargets(parsed, new Set(["VALE3"]));
  assert.equal(none.txs.length, 0);
  assert.equal(none.dropped, 1);
  assert.match(none.alerts[0], /Redução de custo/);
  const both = resolveCostTargets(parsed, new Set(["AUAU3", "C9BS3"]));
  assert.equal(both.txs[0].ticker, "AUAU3");
  assert.match(both.alerts[0], /mais de um destino/);
});

test("resgate sem incorporação na planilha não é aplicado; resgate de renda fixa é ignorado", () => {
  const r = parseB3Rows([resgate(), MOV({ "Movimentação": "Resgate", "Produto": "Tesouro IPCA+ 2035", "Valor da Operação": "R$ 1.000,00" })]);
  assert.equal(r.transactions.length, 0);
  assert.ok(r.alerts.some((a) => /não foi aplicado/.test(a)));
  assert.equal(Object.values(r.skipped).reduce((a, b) => a + b, 0), 2);
});

test("C9BS3 e C9BS4 são aceitos como tickers (dígito no 2º caractere)", () => {
  const r = parseB3Rows([MOV({ "Movimentação": "Dividendo", "Produto": "C9BS3 - COBASI", "Valor da Operação": 10 })]);
  assert.equal(r.proventos.length, 1);
  assert.equal(r.proventos[0].ticker, "C9BS3");
});
