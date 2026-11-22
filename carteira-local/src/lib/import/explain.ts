import { B3_COLUMNS, IMPORT_OPTIONS, MOVIMENTACAO_RULES, NEGOCIACAO_TYPES } from "../../config/b3-columns.ts";
import type { MovRuleTarget } from "../../config/b3-columns.ts";
import { applyTransaction, EMPTY_STATE, averagePrice, typeRank } from "../finance/average-price.ts";
import type { EngineTransaction } from "../finance/types.ts";
import { detectKind, parseB3Rows, resolveColumns } from "./b3-parser.ts";
import type { ParsedTransaction } from "./b3-parser.ts";
import type { FileKind, RawRow } from "./b3-parser.ts";
import { normalizeTicker } from "./classify.ts";
import { normalizeText, parseDate, parseNumber } from "./parse-utils.ts";

export interface ExplainLine {
  row: number; date: string; direction: string; movement: string; product: string;
  qty: number | null; price: number | null; value: number | null; handling: string;
}
export interface ExplainSummary { movement: string; handling: string; count: number; credit: number; debit: number }

function handlingFor(t: MovRuleTarget | undefined): string {
  if (!t) return "SEM REGRA: ignorado (me envie este texto)";
  switch (t.kind) {
    case "provento": return `provento ${t.type}`;
    case "corporate": return "bonificação: crédito de ações com custo";
    case "qty_adjust":
      return `ajuste de quantidade (${t.label}): ` + (t.creditOnly === "split"
        ? "crédito soma à posição mantendo o custo (PM cai); com débito+crédito usa o fator"
        : t.creditOnly === "regroup" ? "crédito = posição final do grupamento; com débito+crédito usa o fator"
        : "só aplicado com débito E crédito");
    case "swap": return `troca/conversão (${t.label}): precisa de débito num ticker e crédito em outro${t.creditOnly === "buy" ? "; crédito isolado vira compra" : ""}`;
    case "redemption": return "resgate: abate o custo do ativo da incorporação (precisa da incorporação na mesma planilha)";
    case "fraction_auction": return "leilão de fração: dinheiro recebido; pareado com a baixa em 'Fração em Ativos' (mesmo ativo e quantidade)";
    case "fraction_credit": return "fração em ativos: crédito vira BONUS de custo zero; débito baixa a fração (pareada com o leilão)";
    case "capital_return": return "restituição de capital: abate o custo do ativo; a quantidade da B3 é informativa (não soma à posição)";
    case "trade": return IMPORT_OPTIONS.importTradesFromMovimentacao ? "negociação" : "negociação: ignorada aqui (entra pela planilha de Negociação)";
    case "skip": return `ignorado: ${t.reason}`;
  }
}

/** Mostra, linha a linha, como o importador interpretaria as linhas de determinados tickers (diagnóstico de divergências). */
export function explainRows(rows: RawRow[], tickers: string[]): { kind: FileKind; lines: ExplainLine[]; summary: ExplainSummary[] } {
  const want = new Set(tickers.map(normalizeTicker));
  const headers = Object.keys(rows[0] ?? {});
  const kind = detectKind(headers);
  if (!kind) throw new Error(`Layout não reconhecido. Colunas: ${headers.join(" | ")}`);
  const lines: ExplainLine[] = [];
  if (kind === "B3_MOVIMENTACAO") {
    const c = resolveColumns(headers, B3_COLUMNS.movimentacao);
    rows.forEach((r, i) => {
      const get = (f: keyof typeof c) => (c[f] ? r[c[f]!] : undefined);
      const product = String(get("product") ?? "").trim();
      if (!want.has(normalizeTicker(product.split(" - ")[0]))) return;
      const movement = String(get("type") ?? "").trim();
      const rule = MOVIMENTACAO_RULES.find((x) => normalizeText(movement).includes(x.match));
      lines.push({
        row: i + 2, date: parseDate(get("date")) ?? String(get("date") ?? ""), direction: String(get("direction") ?? ""), movement, product,
        qty: parseNumber(get("quantity")), price: parseNumber(get("price")), value: parseNumber(get("value")), handling: handlingFor(rule?.target),
      });
    });
  } else {
    const c = resolveColumns(headers, B3_COLUMNS.negociacao);
    rows.forEach((r, i) => {
      const get = (f: keyof typeof c) => (c[f] ? r[c[f]!] : undefined);
      const ticker = normalizeTicker(get("ticker"));
      if (!want.has(ticker)) return;
      const movement = String(get("type") ?? "").trim();
      const t = Object.entries(NEGOCIACAO_TYPES).find(([k]) => normalizeText(movement).includes(k))?.[1];
      lines.push({
        row: i + 2, date: parseDate(get("date")) ?? String(get("date") ?? ""), direction: t === "SELL" ? "Debito" : "Credito", movement, product: ticker,
        qty: parseNumber(get("quantity")), price: parseNumber(get("price")), value: parseNumber(get("value")),
        handling: t ? (t === "BUY" ? "compra" : "venda") : "tipo de negociação não suportado",
      });
    });
  }
  const acc = new Map<string, ExplainSummary>();
  for (const l of lines) {
    const k = `${l.product.split(" - ")[0]}|${l.movement}|${l.handling}`;
    const s = acc.get(k) ?? { movement: `${l.product.split(" - ")[0]} · ${l.movement}`, handling: l.handling, count: 0, credit: 0, debit: 0 };
    s.count++;
    const credit = /^(credito|entrada)/.test(normalizeText(l.direction));
    if (l.qty) { if (credit) s.credit += l.qty; else s.debit += l.qty; }
    acc.set(k, s);
  }
  return { kind, lines, summary: [...acc.values()] };
}

export interface Simulation {
  ticker: string;
  steps: { date: string; type: string; quantity: number; detail: string; positionAfter: number; averagePriceAfter: number }[];
  finalQuantity: number; finalAveragePrice: number; finalCost: number; warnings: string[];
}

/**
 * Simula a posição de UM ticker aplicando os eventos que o importador geraria (todos os arquivos juntos), na mesma
 * ordem lógica do motor. Não inclui o que já está no banco nem trocas de ticker: serve para conferir contra a custódia.
 */
export function simulatePosition(txs: ParsedTransaction[], ticker: string): Simulation {
  const mine = txs.map((t, order) => ({ t, order })).filter((x) => x.t.ticker === ticker && x.t.type !== "TRANSFER_OUT");
  mine.sort((a, b) => (a.t.date < b.t.date ? -1 : a.t.date > b.t.date ? 1 : 0) || typeRank(a.t.type) - typeRank(b.t.type) || a.order - b.order);
  let state = EMPTY_STATE;
  const steps: Simulation["steps"] = [];
  const warnings: string[] = [];
  for (const { t } of mine) {
    const eng: EngineTransaction = { assetId: ticker, type: t.type, date: t.date, quantity: t.quantity, unitPrice: t.unitPrice, fees: 0, taxes: 0, factor: t.factor };
    const r = applyTransaction(state, eng);
    state = r.state;
    if (r.warning) warnings.push(`${t.date} ${t.type}: ${r.warning}`);
    const detail = t.type === "COST_REDUCTION" ? `custo −R$ ${(t.quantity * t.unitPrice).toFixed(2)}` : t.unitPrice ? `a R$ ${t.unitPrice.toFixed(4)}` : "";
    steps.push({ date: t.date, type: t.type, quantity: t.quantity, detail, positionAfter: Number(state.quantity.toFixed(6)), averagePriceAfter: Number(averagePrice(state).toFixed(4)) });
  }
  return { ticker, steps, finalQuantity: Number(state.quantity.toFixed(6)), finalAveragePrice: averagePrice(state), finalCost: state.totalCost, warnings };
}

/** Eventos que o importador lançaria para os tickers pedidos (todas as planilhas juntas) e a posição resultante de cada um. */
export function explainGenerated(allRows: RawRow[][], tickers: string[]): { generated: ParsedTransaction[]; simulations: Simulation[] } {
  const want = new Set(tickers.map(normalizeTicker));
  const generated = allRows.flatMap((rows) => parseB3Rows(rows).transactions).filter((t) => want.has(t.ticker));
  return { generated, simulations: [...want].map((tk) => simulatePosition(generated, tk)) };
}
