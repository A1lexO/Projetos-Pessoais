import Papa from "papaparse";
import * as XLSX from "xlsx";
import { detectKind } from "./b3-parser";
import type { RawRow } from "./b3-parser";

function decodeCsv(buf: Buffer): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^\uFEFF/, ""); }
  catch { return new TextDecoder("latin1").decode(buf); } // CSV antigo da B3 pode vir em ISO-8859-1
}

/** Lê .xlsx/.xls (1ª aba com layout reconhecido) ou .csv (delimitador detectado automaticamente). */
export function readTable(buffer: Buffer, fileName: string): RawRow[] {
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "csv" || ext === "txt") {
    return Papa.parse<RawRow>(decodeCsv(buffer), { header: true, skipEmptyLines: true }).data;
  }
  if (ext === "xlsx" || ext === "xls") {
    const wb = XLSX.read(buffer, { type: "buffer" });
    let fallback: RawRow[] | null = null;
    for (const name of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json<RawRow>(wb.Sheets[name], { defval: null, raw: true });
      if (!rows.length) continue;
      fallback ??= rows;
      if (detectKind(Object.keys(rows[0]))) return rows;
    }
    return fallback ?? [];
  }
  throw new Error("Formato não suportado: envie um arquivo .xlsx ou .csv");
}
