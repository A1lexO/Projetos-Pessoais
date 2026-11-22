import { test } from "node:test";
import assert from "node:assert/strict";
import { parseB3Rows } from "../b3-parser.ts";
import { explainGenerated, explainRows, simulatePosition } from "../explain.ts";

const MOV = (o: Record<string, unknown>) => ({
  "Entrada/Saída": "Credito", "Data": "01/01/2024", "Movimentação": "Desdobro", "Produto": "CASH3 - MELIUZ S.A.",
  "Instituição": "CORRETORA X", "Quantidade": 0, "Preço unitário": "-", "Valor da Operação": "-", ...o,
});
const NEG = (o: Record<string, unknown>) => ({
  "Data do Negócio": "04/04/2023", "Tipo de Movimentação": "Compra", "Mercado": "Mercado à Vista", "Prazo/Vencimento": "-",
  "Instituição": "CORRETORA X", "Código de Negociação": "CASH3", "Quantidade": 256, "Preço": "R$ 0,88", "Valor": "R$ 225,28", ...o,
});
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

const cash3Mov = () => [
  // exatamente como a B3 lista (fora da ordem lógica)
  MOV({ "Data": "02/06/2023", "Entrada/Saída": "Debito", "Movimentação": "Fração em Ativos", "Quantidade": "0,56" }),
  MOV({ "Data": "02/06/2023", "Movimentação": "Desdobro", "Quantidade": 18 }),
  MOV({ "Data": "02/06/2023", "Movimentação": "Grupamento", "Quantidade": "2,56" }),
  MOV({ "Data": "21/06/2023", "Movimentação": "Leilão de Fração", "Quantidade": "0,56", "Preço unitário": "R$ 88,02", "Valor da Operação": "R$ 49,29" }),
  MOV({ "Data": "11/04/2024", "Movimentação": "Restituição de Capital", "Quantidade": 65, "Valor da Operação": "R$ 156,97" }),
  MOV({ "Data": "13/09/2024", "Movimentação": "Restituição de Capital", "Quantidade": 65, "Valor da Operação": "R$ 164,26" }),
];

test("CASH3: as linhas de junho/2023 viram REGROUP + baixa de fração com o valor do leilão + desdobro", () => {
  const r = parseB3Rows(cash3Mov());
  const june = r.transactions.filter((t) => t.date === "2023-06-02");
  assert.deepEqual(june.map((t) => t.type).sort(), ["FRACTION_WRITEOFF", "REGROUP", "SPLIT"]);
  const w = june.find((t) => t.type === "FRACTION_WRITEOFF")!;
  close(w.quantity, 0.56);
  close(w.quantity * w.unitPrice, 49.29);               // valor do leilão de 21/06 anexado à baixa
  assert.equal(r.transactions.some((t) => t.date === "2023-06-21"), false); // o leilão não vira 2ª baixa
  assert.equal(june.find((t) => t.type === "REGROUP")!.quantity, 2.56);
  assert.equal(june.find((t) => t.type === "SPLIT")!.quantity, 18);
  assert.equal(Object.keys(r.skipped).length, 0);
  assert.ok(r.alerts.some((a) => /leiloada em 2023-06-21 por R\$ 49\.29/.test(a)));
});

test("CASH3: Restituição de Capital vira COST_REDUCTION sem somar as 65 'ações' da B3", () => {
  const r = parseB3Rows(cash3Mov());
  const rc = r.transactions.filter((t) => t.type === "COST_REDUCTION");
  assert.equal(rc.length, 2);
  close(rc[0].quantity * rc[0].unitPrice, 156.97);
  close(rc[1].quantity * rc[1].unitPrice, 164.26);
});

test("CASH3 ponta a ponta (Negociação + Movimentação): 256 → 20 ações; custo abatido só pelas restituições", () => {
  const neg = [NEG({}), NEG({ "Data do Negócio": "10/01/2024", "Quantidade": 230, "Preço": "R$ 9,00", "Valor": "R$ 2.070,00" })];
  const { simulations } = explainGenerated([neg, cash3Mov()], ["CASH3"]);
  const s = simulations[0];
  close(s.finalQuantity, 250);                      // 20 após junho/2023 + 230 comprados depois
  const afterJune = s.steps.find((x) => x.type === "SPLIT")!;
  close(afterJune.positionAfter, 20);
  const custoSemRestituicao = 225.28 + 2070;
  close(s.finalCost, custoSemRestituicao - 156.97 - 164.26 - 0.56 * (225.28 / 2.56), 1e-6); // fração baixada ao PM e restituições abatidas
  assert.deepEqual(s.warnings, []);
});

test("CPTS11 e KNSC11: 'Desdobro' de 36 soma à posição sem mexer no custo", () => {
  const rows = (tk: string, prod: string, date: string) => [
    NEG({ "Código de Negociação": tk, "Quantidade": tk === "CPTS11" ? 564 : 414, "Preço": "R$ 8,00", "Valor": "R$ 4.000,00" }),
    MOV({ "Produto": prod, "Data": date, "Quantidade": 36 }),
  ];
  for (const [tk, prod, date, expected] of [["CPTS11", "CPTS11 - CAPITANIA SECURITIES II FII", "27/09/2023", 600], ["KNSC11", "KNSC11 - KINEA CREDITO FII", "07/11/2023", 450]] as const) {
    const r = rows(tk, prod, date);
    const { simulations, generated } = explainGenerated([[r[0]], [r[1]]], [tk]);
    assert.equal(generated.some((t) => t.type === "SPLIT" && t.quantity === 36), true);
    close(simulations[0].finalQuantity, expected);
    close(simulations[0].finalCost, (tk === "CPTS11" ? 564 : 414) * 8);
    close(simulations[0].finalAveragePrice, simulations[0].finalCost / expected);
  }
});

test("baixa de fração sem o leilão na planilha vale R$ 0; leilão sem o débito vale na data do leilão", () => {
  const sem = parseB3Rows([MOV({ "Movimentação": "Fração em Ativos", "Entrada/Saída": "Debito", "Quantidade": "0,3" })]);
  assert.equal(sem.transactions[0].type, "FRACTION_WRITEOFF");
  assert.equal(sem.transactions[0].unitPrice, 0);
  assert.ok(sem.alerts.some((a) => /sem o "Leilão de Fração"/.test(a)));
  const so = parseB3Rows([MOV({ "Data": "21/06/2023", "Movimentação": "Leilão de Fração", "Quantidade": "0,3", "Valor da Operação": "R$ 10,00" })]);
  assert.equal(so.transactions[0].date, "2023-06-21");
  close(so.transactions[0].quantity * so.transactions[0].unitPrice, 10);
});

test("explain: cada linha mostra o tratamento; Desdobro/Grupamento/Fração/Restituição têm regra", () => {
  const { lines } = explainRows(cash3Mov(), ["CASH3"]);
  assert.equal(lines.length, 6);
  assert.equal(lines.some((l) => /SEM REGRA/.test(l.handling)), false);
  assert.match(lines.find((l) => l.movement === "Grupamento")!.handling, /posição final/);
  assert.match(lines.find((l) => l.movement === "Restituição de Capital")!.handling, /abate o custo/);
});
