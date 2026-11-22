import { fractionalPart, receiptBase } from "../finance/corporate.ts";
import { normalizeTicker, TICKER_RE } from "../import/classify.ts";
import { parseNumber } from "../import/parse-utils.ts";

export interface CustodyLine { ticker: string; quantity: number }

/** Aceita linhas "KLBN11 900", "KLBN11;900,0" ou "KLBN11<TAB>900". Linhas sem ticker válido viram erro (cabeçalhos são ignorados). */
export function parseCustodyText(text: string): { lines: CustodyLine[]; errors: string[] } {
  const acc = new Map<string, number>();
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const parts = line.split(/[;\t ]+/).filter(Boolean);
    const ticker = normalizeTicker(parts[0]);
    const qty = parts.length > 1 ? parseNumber(parts[parts.length - 1]) : null;
    if (!TICKER_RE.test(ticker)) { if (i > 0) errors.push(`linha ${i + 1}: "${line}" não parece "TICKER QUANTIDADE"`); return; }
    if (qty == null || qty < 0) { errors.push(`linha ${i + 1}: quantidade inválida em "${line}"`); return; }
    acc.set(ticker, (acc.get(ticker) ?? 0) + qty);
  });
  return { lines: [...acc.entries()].map(([ticker, quantity]) => ({ ticker, quantity })), errors };
}

export type DiffKind = "ok" | "fraction" | "receipt" | "ticker_swap" | "missing_in_system" | "missing_in_custody" | "other";
export interface DiffRow { ticker: string; system: number; real: number; diff: number; kind: DiffKind; hint: string }

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** Compara a posição do sistema com a custódia real e sugere a causa mais provável de cada divergência. */
export function compareCustody(system: { ticker: string; quantity: number }[], real: CustodyLine[]): DiffRow[] {
  const sys = new Map(system.filter((s) => s.quantity > 1e-9).map((s) => [s.ticker, s.quantity]));
  const rl = new Map(real.map((r) => [r.ticker, r.quantity]));
  const tickers = [...new Set([...sys.keys(), ...rl.keys()])].sort();
  const rows: DiffRow[] = [];

  // candidatos a "origem" de uma conversão: estão no sistema, mas não na custódia
  const orphans = tickers.filter((t) => (sys.get(t) ?? 0) > 0 && !(rl.get(t) ?? 0));

  for (const ticker of tickers) {
    const s = sys.get(ticker) ?? 0;
    const r = rl.get(ticker) ?? 0;
    const diff = s - r;
    if (near(diff, 0)) { rows.push({ ticker, system: s, real: r, diff: 0, kind: "ok", hint: "" }); continue; }

    if (diff > 0 && fractionalPart(s) > 0 && near(diff, fractionalPart(s))) {
      rows.push({ ticker, system: s, real: r, diff, kind: "fraction", hint: `fração residual de ${fractionalPart(s)}: use "Baixar fração".` });
      continue;
    }
    if (diff > 0 && r === 0) {
      const base = receiptBase(ticker);
      const target = base ? [`${base}11`, `${base}3`, `${base}4`].find((t) => rl.has(t)) : undefined;
      const hint = target ? `recibo de subscrição: converta para ${target} em "Troca de ticker".` : "sem custódia real: ativo vendido, trocado/incorporado ou recibo convertido? Veja a sugestão no ativo que ficou com saldo a menos.";
      rows.push({ ticker, system: s, real: 0, diff, kind: target ? "receipt" : "missing_in_custody", hint });
      continue;
    }
    if (diff < 0) {
      const need = -diff;
      // recibo (12/13/14) só pode virar um ativo do MESMO prefixo; outros órfãos são candidatos a troca de ticker
      const cand = orphans.find((o) => o !== ticker && near(sys.get(o)!, need) && (!receiptBase(o) || receiptBase(o) === ticker.slice(0, 4)));
      if (cand) {
        const isReceipt = !!receiptBase(cand);
        rows.push({ ticker, system: s, real: r, diff, kind: isReceipt ? "receipt" : "ticker_swap",
          hint: `faltam ${need}, exatamente a posição de ${cand} no sistema: ${isReceipt ? "conversão de recibo" : "troca de ticker/incorporação"} ${cand} → ${ticker} (razão 1).` });
        continue;
      }
      if (s === 0) { rows.push({ ticker, system: 0, real: r, diff, kind: "missing_in_system", hint: "ativo na custódia mas sem posição no sistema: faltam compras/saldo anterior à janela exportada?" }); continue; }
      rows.push({ ticker, system: s, real: r, diff, kind: "other", hint: `faltam ${need} no sistema: histórico anterior à janela exportada, subscrição/bonificação não importada ou desdobramento ausente? Confira a Movimentação deste ativo.` });
      continue;
    }
    rows.push({ ticker, system: s, real: r, diff, kind: "other", hint: `sobram ${diff} no sistema: venda/baixa não importada ou desdobramento/grupamento não aplicado?` });
  }
  return rows;
}
