import type { AssetClass } from "../finance/constants.ts";
import { IMPORT_OPTIONS } from "../../config/b3-columns.ts";
import { normalizeText } from "./parse-utils.ts";

// Raiz de 4 caracteres (1º e 4º letras; 2º e 3º letra ou dígito: B3SA3, C9BS4) + 1 ou 2 dígitos. Exclui códigos de renda fixa como CDB123.
export const TICKER_RE = /^[A-Z][A-Z0-9]{2}[A-Z]\d{1,2}$/;

/** PETR4F (mercado fracionário) -> PETR4 */
export function normalizeTicker(raw: unknown): string {
  const t = String(raw ?? "").trim().toUpperCase();
  const frac = t.match(/^([A-Z][A-Z0-9]{2}[A-Z]\d{1,2})F$/);
  return frac ? frac[1] : t;
}

export interface ClassGuess { assetClass: AssetClass; confident: boolean }

/** Palpite de classe a partir do ticker (+ texto do produto, quando existir). */
export function classifyTicker(ticker: string, productText = ""): ClassGuess {
  const hint = normalizeText(productText);
  if (IMPORT_OPTIONS.knownEtfs.includes(ticker) || /\betf\b|ishares|index fund/.test(hint)) return { assetClass: "ETF", confident: true };
  if (/\bfii\b|fdo inv imob|fundo de investimento imobiliario|fiagro|fdo inv\.? imob/.test(hint)) return { assetClass: "FII", confident: true };
  if (/(32|33|34|35|39)$/.test(ticker) && ticker.length === 6) return { assetClass: "BDR", confident: true };
  if (/11$/.test(ticker)) {
    if (IMPORT_OPTIONS.knownUnits.includes(ticker) || /\bunt\b|\bunit\b/.test(hint)) return { assetClass: "ACAO", confident: true };
    return { assetClass: "FII", confident: hint.length > 0 }; // sem texto: presumido
  }
  return { assetClass: "ACAO", confident: true };
}
