import { EPS } from "./average-price.ts";
import type { EngineTransaction } from "./types.ts";

/**
 * Cotações de provedores (Yahoo) vêm ajustadas por desdobramentos/grupamentos.
 * Para casar com elas, reescrevemos o livro na base do último evento:
 * para cada SPLIT de fator k na data D, operações anteriores a D têm quantidade × k
 * e preço ÷ k (valor financeiro, PM total e fluxos não mudam). O evento some.
 * BONUS não é ajustado (limitação conhecida).
 */
export function normalizeSplits(transactions: EngineTransaction[]): EngineTransaction[] {
  const byAsset = new Map<string, EngineTransaction[]>();
  for (const t of transactions) {
    const list = byAsset.get(t.assetId) ?? [];
    list.push(t);
    byAsset.set(t.assetId, list);
  }
  const out: EngineTransaction[] = [];
  for (const list of byAsset.values()) {
    const sorted = [...list].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    // 1) descobre fator de cada split simulando a quantidade bruta
    const events: { date: string; k: number; pos: number }[] = [];
    let qty = 0;
    sorted.forEach((t, pos) => {
      if (t.type === "BUY" || t.type === "BONUS") qty += t.quantity;
      else if (t.type === "SELL" || t.type === "MATURITY" || t.type === "AMORTIZATION") qty -= t.quantity;
      else if (t.type === "SPLIT" || t.type === "REVERSE_SPLIT") {
        let k = t.factor ?? null;
        if (k == null) {
          const delta = t.type === "SPLIT" ? t.quantity : -t.quantity;
          k = qty > EPS ? (qty + delta) / qty : 1;
        }
        events.push({ date: t.date, k, pos });
        qty *= k;
      }
    });
    // 2) reescreve
    sorted.forEach((t, pos) => {
      if (t.type === "SPLIT" || t.type === "REVERSE_SPLIT") return;
      let mult = 1;
      for (const e of events) if (e.pos > pos) mult *= e.k;
      if (mult === 1 || (t.type !== "BUY" && t.type !== "SELL" && t.type !== "MATURITY" && t.type !== "AMORTIZATION")) {
        out.push(t);
      } else {
        out.push({ ...t, quantity: t.quantity * mult, unitPrice: t.unitPrice / mult });
      }
    });
  }
  return out;
}
