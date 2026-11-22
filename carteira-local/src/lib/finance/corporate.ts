import { EPS } from "./average-price.ts";
import { daysBetween } from "./dates.ts";

export const LISTED_CLASSES = ["ACAO", "FII", "ETF", "BDR"];

/** Parte fracionária residual (ação/cota negociada é inteira na B3). 900,8 -> 0,8 ; 900,9999999 -> 0. */
export function fractionalPart(q: number, tol = 1e-6): number {
  const frac = q - Math.floor(q + tol);
  return frac > tol ? Math.round(frac * 1e8) / 1e8 : 0;
}

/** KNSC12 / KNSC13 / KNSC14 -> "KNSC" (recibos de subscrição de FIIs). */
export function receiptBase(ticker: string): string | null {
  const m = ticker.match(/^([A-Z]{4})(12|13|14)$/);
  return m ? m[1] : null;
}

export interface PositionLite { ticker: string; assetClass: string; quantity: number; lastQuoteDate?: string | null }

export interface ConversionSuggestion { from: string; to: string; quantity: number; toExists: boolean; reason: string }

/** Posições abertas em recibos (12/13/14) com ativo principal conhecido (11, 3, 4, 5, 6) ou o provável `…11`. */
export function suggestConversions(positions: PositionLite[], knownTickers: string[]): ConversionSuggestion[] {
  const known = new Set(knownTickers);
  const out: ConversionSuggestion[] = [];
  for (const p of positions) {
    const base = receiptBase(p.ticker);
    if (!base || p.quantity <= EPS) continue;
    const sibling = ["11", "3", "4", "5", "6"].map((s) => `${base}${s}`).find((t) => known.has(t));
    out.push({ from: p.ticker, to: sibling ?? `${base}11`, quantity: p.quantity, toExists: !!sibling, reason: "recibo de subscrição ainda com posição aberta" });
  }
  return out;
}

export interface StaleHint { ticker: string; quantity: number; lastQuoteDate: string | null; daysStale: number | null }

/** Posições abertas sem cotação recente: típico de ticker incorporado/renomeado/deslistado. */
export function staleQuoteHints(positions: PositionLite[], today: string, maxDays = 15): StaleHint[] {
  const out: StaleHint[] = [];
  for (const p of positions) {
    if (p.quantity <= EPS || !LISTED_CLASSES.includes(p.assetClass)) continue;
    const days = p.lastQuoteDate ? daysBetween(p.lastQuoteDate, today) : null;
    if (days == null || days > maxDays) out.push({ ticker: p.ticker, quantity: p.quantity, lastQuoteDate: p.lastQuoteDate ?? null, daysStale: days });
  }
  return out;
}

/**
 * O fator é uma razão "de desdobramento" (2:1, 3:2, 1:10, 11:10…)? Razões com denominador > 20 (ex.: 450/414 = 25/23)
 * são créditos avulsos de quantidade (sobras, bonificação irregular): somam à posição e baixam o PM, mas as cotações
 * dos provedores NÃO foram ajustadas por eles, então não devem ser "des-ajustadas".
 */
export function isPlausibleSplitFactor(k: number, maxDen = 20, tol = 1e-6): boolean {
  if (!Number.isFinite(k) || k <= 0 || Math.abs(k - 1) < 1e-12) return false;
  const ratio = (x: number) => {
    for (let den = 1; den <= maxDen; den++) {
      const num = x * den;
      if (Math.abs(num - Math.round(num)) < tol * Math.max(1, den)) return true;
    }
    return false;
  };
  return ratio(k) || ratio(1 / k); // 1:100 (0,01) é inteiro pelo inverso; 23/25 não é em nenhum dos dois
}
