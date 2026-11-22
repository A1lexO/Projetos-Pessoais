import { createHash } from "node:crypto";
import { toDayKey } from "../finance/dates.ts";

export const normalizeText = (s: unknown): string =>
  String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** "R$ 1.234,56" | "1.234,56" | 12.5 | "-" -> número ou null. Formato brasileiro quando há vírgula. */
export function parseNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v == null) return null;
  let s = String(v).trim().replace(/R\$\s?/gi, "").replace(/\s/g, "");
  if (!s || s === "-") return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if ((s.match(/\./g) ?? []).length > 1) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const validDay = (y: number, m: number, d: number): string | null => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? toDayKey(dt) : null;
};

/** "dd/mm/yyyy" | "yyyy-mm-dd" | serial do Excel | Date -> YYYY-MM-DD (ou null). */
export function parseDate(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : toDayKey(v);
  if (typeof v === "number") {
    if (v < 20000 || v > 80000) return null;
    return toDayKey(new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86_400_000));
  }
  if (v == null) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return validDay(+m[3], +m[2], +m[1]);
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return validDay(+m[1], +m[2], +m[3]);
  return null;
}

/** Hash determinístico de uma linha (base da deduplicação). */
export const hashParts = (parts: (string | number | null | undefined)[]): string =>
  createHash("sha1").update(parts.map((p) => String(p ?? "")).join("|")).digest("hex").slice(0, 32);

export const isBlankRow = (row: Record<string, unknown>): boolean =>
  Object.values(row).every((v) => v == null || String(v).trim() === "");
