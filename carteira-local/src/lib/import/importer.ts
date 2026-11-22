import { prisma } from "../db/prisma";
import { fromDayKey } from "../finance/dates";
import { rebuildSnapshots } from "../services/snapshots";
import { classifyTicker } from "./classify";
import { parseB3Rows } from "./b3-parser";
import type { FileKind, ParseIssue, ParsedProvento, ParsedTransaction } from "./b3-parser";
import { resolveCostTargets } from "./resolve";
import { readTable } from "./read-file";

const chunk = <T,>(a: T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));

export interface ImportPreview {
  fileName: string; kind: FileKind; rowsTotal: number;
  transactions: { total: number; new: number; duplicate: number };
  proventos: { total: number; new: number; duplicate: number };
  skipped: { reason: string; count: number }[];
  unknownAssets: { ticker: string; assetClass: string; confident: boolean; rows: number }[];
  alerts: string[];
  /** eventos corporativos e ajustes entre os registros novos (tipo -> nº) */
  events: { type: string; count: number }[];
  issues: ParseIssue[]; issueCount: number;
  dateRange: { from: string; to: string } | null;
}

async function existingIds(model: "transaction" | "provento", source: string, ids: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (const part of chunk(ids, 500)) {
    const rows = model === "transaction"
      ? await prisma.transaction.findMany({ where: { source, externalId: { in: part } }, select: { externalId: true } })
      : await prisma.provento.findMany({ where: { source, externalId: { in: part } }, select: { externalId: true } });
    for (const r of rows) if (r.externalId) found.add(r.externalId);
  }
  return found;
}

async function analyze(buffer: Buffer, fileName: string) {
  const parsed = parseB3Rows(readTable(buffer, fileName));
  // resgate de incorporação: o destino é o candidato que já existe (no banco ou neste lote)
  const wanted = [...new Set(parsed.transactions.flatMap((t) => t.costTargets ?? []))];
  if (wanted.length) {
    const known = new Set<string>((await prisma.asset.findMany({ where: { ticker: { in: wanted } }, select: { ticker: true } })).map((x: { ticker: string }) => x.ticker));
    for (const t of parsed.transactions) if (!t.costTargets) { known.add(t.ticker); if (t.counterpartTicker) known.add(t.counterpartTicker); }
    const r = resolveCostTargets(parsed.transactions, known);
    parsed.transactions = r.txs;
    parsed.alerts.push(...r.alerts);
    if (r.dropped) parsed.skipped['resgate sem ativo de destino: lance em "Redução de custo"'] = r.dropped;
  }
  const [txIds, provIds] = await Promise.all([
    existingIds("transaction", parsed.kind, parsed.transactions.map((t) => t.externalId)),
    existingIds("provento", parsed.kind, parsed.proventos.map((p) => p.externalId)),
  ]);
  const newTx: ParsedTransaction[] = parsed.transactions.filter((t) => !txIds.has(t.externalId));
  const newProv: ParsedProvento[] = parsed.proventos.filter((p) => !provIds.has(p.externalId));

  const rowsByTicker = new Map<string, { assetClass: string; confident: boolean; rows: number; firstDate: string; firstType: string }>();
  const touch = (ticker: string, assetClass: string, confident: boolean, date: string, type: string) => {
    const cur = rowsByTicker.get(ticker);
    if (!cur) rowsByTicker.set(ticker, { assetClass, confident, rows: 1, firstDate: date, firstType: type });
    else { cur.rows++; if (date < cur.firstDate) { cur.firstDate = date; cur.firstType = type; } }
  };
  newTx.forEach((t) => {
    touch(t.ticker, t.assetClass, t.classConfident, t.date, t.type);
    if (t.counterpartTicker) { // destino da troca também precisa existir
      const g = classifyTicker(t.counterpartTicker);
      touch(t.counterpartTicker, g.assetClass, g.confident, t.date, "TRANSFER_IN");
    }
  });
  newProv.forEach((p) => touch(p.ticker, p.assetClass, p.classConfident, p.paymentDate, "PROVENTO"));
  const tickers = [...rowsByTicker.keys()];
  const known = new Set((await prisma.asset.findMany({ where: { ticker: { in: tickers } }, select: { ticker: true } })).map((a) => a.ticker));
  const unknown = tickers.filter((t) => !known.has(t)).map((ticker) => ({ ticker, ...rowsByTicker.get(ticker)! }));

  const alerts: string[] = [...parsed.alerts];
  for (const u of unknown) {
    if (!u.confident) alerts.push(`${u.ticker}: classe presumida como ${u.assetClass}; confira após importar.`);
    if (u.firstType === "SELL") alerts.push(`${u.ticker}: a primeira operação é uma venda (${u.firstDate}); histórico de compras incompleto?`);
  }
  const dates = [...newTx.map((t) => t.date), ...newProv.map((p) => p.paymentDate)].sort();
  const evCount = new Map<string, number>();
  for (const t of newTx) if (t.type !== "BUY" && t.type !== "SELL") evCount.set(t.type, (evCount.get(t.type) ?? 0) + 1);
  const events = [...evCount.entries()].map(([type, count]) => ({ type, count }));
  return { parsed, newTx, newProv, unknown, alerts, dates, events };
}

export async function previewImport(buffer: Buffer, fileName: string): Promise<ImportPreview> {
  const a = await analyze(buffer, fileName);
  const { parsed } = a;
  return {
    fileName, kind: parsed.kind, rowsTotal: parsed.rowsTotal,
    transactions: { total: parsed.transactions.length, new: a.newTx.length, duplicate: parsed.transactions.length - a.newTx.length },
    proventos: { total: parsed.proventos.length, new: a.newProv.length, duplicate: parsed.proventos.length - a.newProv.length },
    skipped: Object.entries(parsed.skipped).map(([reason, count]) => ({ reason, count })).sort((x, y) => y.count - x.count),
    unknownAssets: a.unknown.map((u) => ({ ticker: u.ticker, assetClass: u.assetClass, confident: u.confident, rows: u.rows })),
    alerts: a.alerts, events: a.events,
    issues: parsed.issues.slice(0, 100), issueCount: parsed.issues.length,
    dateRange: a.dates.length ? { from: a.dates[0], to: a.dates[a.dates.length - 1] } : null,
  };
}

export async function commitImport(buffer: Buffer, fileName: string, opts: { rebuild?: boolean } = {}) {
  const a = await analyze(buffer, fileName);
  const { parsed } = a;
  const duplicates = parsed.transactions.length - a.newTx.length + parsed.proventos.length - a.newProv.length;
  if (!a.newTx.length && !a.newProv.length) return { batchId: null as string | null, inserted: { transactions: 0, proventos: 0 }, duplicates, createdAssets: 0, rebuilt: null };

  const batchId = await prisma.$transaction(async (db) => {
    const batch = await db.importBatch.create({
      data: {
        fileName, fileKind: parsed.kind, rowsTotal: parsed.rowsTotal,
        rowsImported: a.newTx.length + a.newProv.length, rowsSkipped: duplicates, rowsFailed: parsed.issues.filter((i) => i.level === "error").length,
        errorLog: parsed.issues.length ? JSON.stringify(parsed.issues.slice(0, 200)) : null,
      },
    });
    if (a.unknown.length) await db.asset.createMany({ data: a.unknown.map((u) => ({ ticker: u.ticker, assetClass: u.assetClass })) });
    const tickers = [...new Set([...a.newTx.flatMap((t) => (t.counterpartTicker ? [t.ticker, t.counterpartTicker] : [t.ticker])), ...a.newProv.map((p) => p.ticker)])];
    const idByTicker = new Map((await db.asset.findMany({ where: { ticker: { in: tickers } } })).map((x) => [x.ticker, x.id]));
    for (const part of chunk(a.newTx, 200)) {
      await db.transaction.createMany({
        data: part.map((t) => ({
          assetId: idByTicker.get(t.ticker)!, type: t.type, tradeDate: fromDayKey(t.date), quantity: t.quantity, unitPrice: t.unitPrice,
          fees: 0, taxes: 0, factor: t.factor, counterpartAssetId: t.counterpartTicker ? idByTicker.get(t.counterpartTicker) ?? null : null,
          source: t.source, externalId: t.externalId, importBatchId: batch.id, notes: t.institution,
        })),
      });
    }
    for (const part of chunk(a.newProv, 200)) {
      await db.provento.createMany({
        data: part.map((p) => ({
          assetId: idByTicker.get(p.ticker)!, type: p.type, paymentDate: fromDayKey(p.paymentDate), quantity: p.quantity,
          grossAmount: p.netAmount, taxWithheld: 0, netAmount: p.netAmount, source: p.source, externalId: p.externalId, importBatchId: batch.id,
        })),
      });
    }
    // ticker de origem de uma troca deixa de ser consultado nos syncs; o destino volta a ficar ativo
    const from = a.newTx.filter((t) => t.type === "TRANSFER_OUT").map((t) => t.ticker);
    const to = a.newTx.filter((t) => t.counterpartTicker).map((t) => t.counterpartTicker!);
    if (from.length) await db.asset.updateMany({ where: { ticker: { in: from } }, data: { isActive: false } });
    if (to.length) await db.asset.updateMany({ where: { ticker: { in: to } }, data: { isActive: true } });
    return batch.id;
  }, { timeout: 120_000, maxWait: 10_000 });

  const rebuilt = opts.rebuild === false ? null : await rebuildSnapshots();
  return { batchId, inserted: { transactions: a.newTx.length, proventos: a.newProv.length }, duplicates, createdAssets: a.unknown.length, rebuilt: rebuilt ? { days: rebuilt.days, warnings: rebuilt.warnings } : null };
}

/** Desfaz um lote inteiro (operações e proventos importados nele). Ativos criados permanecem. */
export async function undoBatch(id: string) {
  await prisma.$transaction([
    prisma.transaction.deleteMany({ where: { importBatchId: id } }),
    prisma.provento.deleteMany({ where: { importBatchId: id } }),
    prisma.importBatch.delete({ where: { id } }),
  ]);
  return rebuildSnapshots();
}
