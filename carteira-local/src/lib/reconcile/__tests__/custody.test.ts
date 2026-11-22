import { test } from "node:test";
import assert from "node:assert/strict";
import { compareCustody, parseCustodyText } from "../custody.ts";

test("parse da custódia colada: separadores variados, vírgula decimal, cabeçalho ignorado, duplicatas somadas", () => {
  const r = parseCustodyText("Ativo\tQuantidade\nKLBN11\t900\nKNSC11;450,0\nPETR4F 100\nPETR4 50\nlixo aqui\nVALE3 -3");
  assert.deepEqual(r.lines, [{ ticker: "KLBN11", quantity: 900 }, { ticker: "KNSC11", quantity: 450 }, { ticker: "PETR4", quantity: 150 }]);
  assert.equal(r.errors.length, 2);
});

test("divergências do caso real: fração, recibo, troca de ticker e saldo sem causa óbvia", () => {
  const rows = compareCustody(
    [
      { ticker: "KLBN11", quantity: 900.8 }, { ticker: "KNSC11", quantity: 414 }, { ticker: "KNSC12", quantity: 36 },
      { ticker: "AUAU3", quantity: 100 }, { ticker: "PETZ3", quantity: 800 }, { ticker: "CPTS11", quantity: 564 }, { ticker: "VALE3", quantity: 10 },
    ],
    [
      { ticker: "KLBN11", quantity: 900 }, { ticker: "KNSC11", quantity: 450 }, { ticker: "AUAU3", quantity: 900 },
      { ticker: "CPTS11", quantity: 600 }, { ticker: "VALE3", quantity: 10 },
    ],
  );
  const k = Object.fromEntries(rows.map((r) => [r.ticker, r]));
  assert.equal(k.KLBN11.kind, "fraction");
  assert.equal(k.KNSC11.kind, "receipt");
  assert.match(k.KNSC11.hint, /KNSC12 → KNSC11/);
  assert.equal(k.KNSC12.kind, "receipt");
  assert.match(k.KNSC12.hint, /converta para KNSC11/);
  assert.equal(k.PETZ3.kind, "missing_in_custody");
  assert.equal(k.AUAU3.kind, "ticker_swap");
  assert.match(k.AUAU3.hint, /PETZ3 → AUAU3/);
  assert.equal(k.CPTS11.kind, "other");                  // 36 a menos: sem causa inferível sozinha
  assert.equal(k.VALE3.kind, "ok");
});
