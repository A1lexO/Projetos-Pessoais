import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { explainGenerated, explainRows } from "../src/lib/import/explain";
import { readTable } from "../src/lib/import/read-file";

// uso: npm run explain:b3 -- Movimentacao.xlsx Negociacao.xlsx CASH3 CPTS11 KNSC11
// (argumentos terminados em .xlsx/.xls/.csv são arquivos; os demais são tickers)
const args = process.argv.slice(2);
const files = args.filter((a) => /\.(xlsx|xls|csv)$/i.test(a));
const tickers = args.filter((a) => !/\.(xlsx|xls|csv)$/i.test(a));
if (!files.length || !tickers.length) {
  console.error("uso: npm run explain:b3 -- <arquivo.xlsx> [outro.xlsx] TICKER [TICKER...]");
  process.exit(1);
}
const tables = files.map((f) => readTable(readFileSync(f), basename(f)));

tables.forEach((rows, i) => {
  const { kind, lines, summary } = explainRows(rows, tickers);
  console.log(`\n######## ${basename(files[i])} (${kind}) — ${lines.length} linhas dos tickers pedidos ########`);
  console.log("=== RESUMO por tipo (crédito/débito em quantidade) ===");
  console.table(summary);
  console.log("=== LINHAS (como o importador interpreta cada uma) ===");
  console.table(lines.map((l) => ({ linha: l.row, data: l.date, dir: l.direction, tipo: l.movement, produto: l.product.slice(0, 28), qtd: l.qty, preco: l.price, valor: l.value, tratamento: l.handling })));
});

const { generated, simulations } = explainGenerated(tables, tickers);
console.log("\n######## EVENTOS QUE O IMPORTADOR LANÇARIA (todos os arquivos juntos) ########");
console.table(generated.map((t) => ({ data: t.date, ticker: t.ticker, tipo: t.type, qtd: t.quantity, preco: Number(t.unitPrice.toFixed(6)), fator: t.factor, origem: t.source.replace("B3_", "") })));
for (const s of simulations) {
  console.log(`\n=== POSIÇÃO SIMULADA de ${s.ticker}: ${s.finalQuantity} ações · PM R$ ${s.finalAveragePrice.toFixed(4)} · custo R$ ${s.finalCost.toFixed(2)} ===`);
  console.table(s.steps);
  if (s.warnings.length) console.warn("avisos:", s.warnings);
}
console.log("\nObs.: a simulação usa só estas planilhas; lançamentos manuais e trocas de ticker já no banco não entram.");
