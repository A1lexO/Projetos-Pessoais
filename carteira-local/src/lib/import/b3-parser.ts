import { B3_COLUMNS, IMPORT_OPTIONS, MOVIMENTACAO_RULES, NEGOCIACAO_TYPES } from "../../config/b3-columns.ts";
import type { AssetClass, ProventoType, TransactionType } from "../finance/constants.ts";
import { classifyTicker, normalizeTicker, TICKER_RE } from "./classify.ts";
import type { ClassGuess } from "./classify.ts";
import { hashParts, isBlankRow, normalizeText, parseDate, parseNumber } from "./parse-utils.ts";

export type FileKind = "B3_NEGOCIACAO" | "B3_MOVIMENTACAO";
export type RawRow = Record<string, unknown>;

export interface ParsedTransaction {
  ticker: string; assetClass: AssetClass; classConfident: boolean;
  type: TransactionType; date: string; quantity: number; unitPrice: number;
  /** SPLIT/REVERSE_SPLIT explícito; TRANSFER_OUT: razão (qtd destino ÷ qtd origem) */
  factor: number | null;
  /** TRANSFER_OUT: ticker que recebe a posição */
  counterpartTicker: string | null;
  /** COST_REDUCTION vindo de "Resgate": candidatos a ativo de destino (o importador escolhe o que existe) */
  costTargets: string[] | null;
  source: FileKind; externalId: string; institution: string | null;
}
export interface ParsedProvento {
  ticker: string; assetClass: AssetClass; classConfident: boolean;
  type: ProventoType; paymentDate: string; quantity: number | null; netAmount: number;
  source: FileKind; externalId: string;
}
export interface ParseIssue { row: number; level: "warn" | "error"; message: string }
export interface ParseResult {
  kind: FileKind; rowsTotal: number;
  transactions: ParsedTransaction[]; proventos: ParsedProvento[];
  /** motivo -> nº de linhas ignoradas */
  skipped: Record<string, number>;
  issues: ParseIssue[];
  /** eventos corporativos interpretados (confira antes de confirmar) */
  alerts: string[];
}

type Spec = Record<string, readonly string[]>;
export function resolveColumns<T extends Spec>(headers: string[], spec: T): { [K in keyof T]?: string } {
  const byNorm = new Map(headers.map((h) => [normalizeText(h), h]));
  const out: Record<string, string> = {};
  for (const [field, aliases] of Object.entries(spec)) {
    for (const a of aliases) {
      const hit = byNorm.get(normalizeText(a));
      if (hit) { out[field] = hit; break; }
    }
  }
  return out as { [K in keyof T]?: string };
}

export function detectKind(headers: string[]): FileKind | null {
  const mov = resolveColumns(headers, B3_COLUMNS.movimentacao);
  if (mov.direction && mov.product && mov.type && mov.date) return "B3_MOVIMENTACAO";
  const neg = resolveColumns(headers, B3_COLUMNS.negociacao);
  if (neg.date && neg.type && neg.ticker && neg.quantity && neg.price) return "B3_NEGOCIACAO";
  return null;
}

interface MovEntry {
  row: number; ticker: string; credit: boolean; qty: number | null; price: number | null; value: number | null;
  date: string; inst: string | null; guess: ClassGuess;
}
type SwapRule = Extract<(typeof MOVIMENTACAO_RULES)[number]["target"], { kind: "swap" }>;
type AdjRule = Extract<(typeof MOVIMENTACAO_RULES)[number]["target"], { kind: "qty_adjust" }>;

export function parseB3Rows(rows: RawRow[], forcedKind?: FileKind): ParseResult {
  const headers = Object.keys(rows[0] ?? {});
  const kind = forcedKind ?? detectKind(headers);
  if (!kind) throw new Error(`Layout não reconhecido. Colunas encontradas: ${headers.join(" | ") || "(nenhuma)"}. Ajuste src/config/b3-columns.ts.`);
  const res: ParseResult = { kind, rowsTotal: 0, transactions: [], proventos: [], skipped: {}, issues: [], alerts: [] };
  const skip = (reason: string, n = 1) => { res.skipped[reason] = (res.skipped[reason] ?? 0) + n; };
  const seen = new Map<string, number>();
  const nth = (key: string) => { const n = seen.get(key) ?? 0; seen.set(key, n + 1); return n; };
  const pushTx = (t: Omit<ParsedTransaction, "factor" | "counterpartTicker" | "costTargets"> & Partial<Pick<ParsedTransaction, "factor" | "counterpartTicker" | "costTargets">>) =>
    res.transactions.push({ factor: null, counterpartTicker: null, costTargets: null, ...t });

  // ------------------------------------------------------------------ Negociação
  if (kind === "B3_NEGOCIACAO") {
    const c = resolveColumns(headers, B3_COLUMNS.negociacao);
    rows.forEach((r, i) => {
      if (isBlankRow(r)) return;
      res.rowsTotal++;
      const row = i + 2;
      const get = (f: keyof typeof c) => (c[f] ? r[c[f]!] : undefined);
      const typeText = normalizeText(get("type"));
      const type = Object.entries(NEGOCIACAO_TYPES).find(([k]) => typeText.includes(k))?.[1];
      if (!type) return skip(`tipo de negociação não suportado: "${typeText}"`);
      const market = normalizeText(get("market"));
      if (IMPORT_OPTIONS.skipMarkets.some((m) => market.includes(m))) return skip(`mercado não suportado: ${market}`);
      const ticker = normalizeTicker(get("ticker"));
      if (!TICKER_RE.test(ticker)) {
        if (!ticker) { res.issues.push({ row, level: "error", message: "linha sem código de negociação" }); return; }
        return skip("código fora do padrão de ação/FII/ETF/BDR (renda fixa? cadastre manualmente)");
      }
      const date = parseDate(get("date"));
      const qty = parseNumber(get("quantity"));
      let price = parseNumber(get("price"));
      const value = parseNumber(get("value"));
      if (price == null && value != null && qty) price = value / qty;
      if (!date || !qty || qty <= 0 || price == null || price < 0) {
        res.issues.push({ row, level: "error", message: `dados inválidos (data=${get("date")}, qtd=${get("quantity")}, preço=${get("price")})` });
        return;
      }
      const inst = c.institution ? String(r[c.institution] ?? "").trim() || null : null;
      const base = [kind, date, type, ticker, qty, price, inst];
      const guess = classifyTicker(ticker);
      pushTx({
        ticker, assetClass: guess.assetClass, classConfident: guess.confident, type, date,
        quantity: qty, unitPrice: price, source: kind, institution: inst,
        externalId: hashParts([...base, nth(base.join("|"))]),
      });
    });
    return res;
  }

  // ------------------------------------------------------------------ Movimentação
  const c = resolveColumns(headers, B3_COLUMNS.movimentacao);
  const swapGroups = new Map<string, { rule: SwapRule; date: string; entries: MovEntry[] }>();
  const adjGroups = new Map<string, { rule: AdjRule; date: string; ticker: string; entries: MovEntry[] }>();
  const redemptions: MovEntry[] = [];
  const fractionDebits: MovEntry[] = [];
  const auctions: MovEntry[] = [];

  rows.forEach((r, i) => {
    if (isBlankRow(r)) return;
    res.rowsTotal++;
    const row = i + 2;
    const get = (f: keyof typeof c) => (c[f] ? r[c[f]!] : undefined);
    const typeRaw = String(get("type") ?? "").trim();
    const typeText = normalizeText(typeRaw);
    const dir = normalizeText(get("direction"));
    const credit = dir.startsWith("credito") || dir.startsWith("entrada");
    const debit = dir.startsWith("debito") || dir.startsWith("saida");
    const rule = MOVIMENTACAO_RULES.find((x) => typeText.includes(x.match));
    if (!rule) return skip(`tipo não suportado: ${typeRaw}`);
    const t = rule.target;
    if (t.kind === "skip") return skip(t.reason);
    if (t.kind === "trade" && !IMPORT_OPTIONS.importTradesFromMovimentacao)
      return skip("negociação (importe pela planilha de Negociação para não duplicar)");

    const product = String(get("product") ?? "").trim();
    const ticker = normalizeTicker(product.split(" - ")[0]);
    if (!TICKER_RE.test(ticker)) return skip("produto fora do padrão de ação/FII/ETF/BDR (renda fixa? cadastre manualmente)");
    const guess = classifyTicker(ticker, product);
    const date = parseDate(get("date"));
    const qty = parseNumber(get("quantity"));
    const price = parseNumber(get("price"));
    const value = parseNumber(get("value"));
    if (!date) { res.issues.push({ row, level: "error", message: `data inválida (${get("date")})` }); return; }
    const inst = c.institution ? String(r[c.institution] ?? "").trim() || null : null;
    const entry: MovEntry = { row, ticker, credit, qty, price, value, date, inst, guess };
    const common = { ticker, assetClass: guess.assetClass, classConfident: guess.confident, source: kind, institution: inst, date } as const;

    if (t.kind === "provento") {
      if (!credit) return skip("provento com saída/débito (estorno?) ignorado");
      if (value == null || value <= 0) { res.issues.push({ row, level: "error", message: "provento sem valor" }); return; }
      const base = [kind, date, ticker, t.type, value];
      res.proventos.push({
        ticker, assetClass: guess.assetClass, classConfident: guess.confident, type: t.type,
        paymentDate: date, quantity: qty && qty > 0 ? qty : null, netAmount: value,
        source: kind, externalId: hashParts([...base, nth(base.join("|"))]),
      });
      return;
    }
    if (t.kind === "corporate") { // bonificação
      if (!credit || !qty || qty <= 0) return skip("bonificação sem crédito de quantidade");
      const base = [kind, date, ticker, t.type, qty];
      pushTx({ ...common, type: "BONUS", quantity: qty, unitPrice: price ?? 0, externalId: hashParts([...base, nth(base.join("|"))]) });
      return;
    }
    if (t.kind === "fraction_auction") { // pareado depois com a baixa da fração
      if (!qty || qty <= 0) return skip("leilão de fração sem quantidade");
      auctions.push(entry);
      return;
    }
    if (t.kind === "fraction_credit") {
      if (!qty || qty <= 0) return skip("fração em ativos sem quantidade");
      if (debit) { fractionDebits.push(entry); return; } // baixa da fração (pareada com o leilão)
      const base = [kind, date, ticker, "FRACTION_CREDIT", qty];
      pushTx({ ...common, type: "BONUS", quantity: qty, unitPrice: 0, externalId: hashParts([...base, nth(base.join("|"))]) });
      return;
    }
    if (t.kind === "capital_return") {
      if (!credit || value == null || value <= 0) return skip("restituição de capital sem crédito/valor");
      const q = qty && qty > 0 ? qty : 1;
      const base = [kind, date, ticker, "COST_REDUCTION", q, value];
      pushTx({ ...common, type: "COST_REDUCTION", quantity: q, unitPrice: value / q, externalId: hashParts([...base, nth(base.join("|"))]) });
      res.alerts.push(`${ticker}: restituição de capital de R$ ${value.toFixed(2)} em ${date} abate o custo (a quantidade ${q} da B3 é informativa e não entra na posição).`);
      return;
    }
    if (t.kind === "redemption") {
      if (!credit || !qty || qty <= 0 || value == null || value <= 0) return skip("resgate sem crédito de quantidade/valor");
      redemptions.push(entry);
      return;
    }
    if (t.kind === "swap") {
      const key = `${date}|${rule.match}`;
      (swapGroups.get(key) ?? swapGroups.set(key, { rule: t, date, entries: [] }).get(key)!).entries.push(entry);
      return;
    }
    if (t.kind === "qty_adjust") {
      const key = `${date}|${ticker}|${rule.match}`;
      (adjGroups.get(key) ?? adjGroups.set(key, { rule: t, date, ticker, entries: [] }).get(key)!).entries.push(entry);
      return;
    }
    // trade (só com importTradesFromMovimentacao = true)
    if (!qty || qty <= 0 || price == null || (!credit && !debit)) {
      res.issues.push({ row, level: "error", message: "negociação com dados incompletos" });
      return;
    }
    const type: TransactionType = credit ? "BUY" : "SELL";
    const base = [kind, date, type, ticker, qty, price, inst];
    pushTx({ ...common, type, quantity: qty, unitPrice: price, externalId: hashParts([...base, nth(base.join("|"))]) });
  });

  // ---- ajustes de quantidade (desdobramento / grupamento / atualização)
  const emitAdjust = (entries: MovEntry[], rule: AdjRule | SwapRule, ticker: string, date: string) => {
    const credits = entries.filter((e) => e.credit && e.qty && e.qty > 0);
    const debits = entries.filter((e) => !e.credit && e.qty && e.qty > 0);
    const sumC = credits.reduce((a, e) => a + e.qty!, 0);
    const sumD = debits.reduce((a, e) => a + e.qty!, 0);
    const first = entries[0];
    const common = { ticker, assetClass: first.guess.assetClass, classConfident: first.guess.confident, source: kind, institution: first.inst, date } as const;
    if (!debits.length) {
      if (rule.kind === "qty_adjust" && rule.creditOnly === "split") {
        for (const e of credits) { // mesmo esquema de externalId de antes: reimportar não duplica
          const base = [kind, date, ticker, "SPLIT", e.qty];
          pushTx({ ...common, type: "SPLIT", quantity: e.qty!, unitPrice: 0, externalId: hashParts([...base, nth(base.join("|"))]) });
          res.alerts.push(`${ticker}: ${rule.label} de +${e.qty} em ${date}: soma à posição mantendo o custo total (o PM diminui).`);
        }
        return;
      }
      if (rule.kind === "qty_adjust" && rule.creditOnly === "regroup") {
        for (const e of credits) {
          const base = [kind, date, ticker, "REGROUP", e.qty];
          pushTx({ ...common, type: "REGROUP", quantity: e.qty!, unitPrice: 0, externalId: hashParts([...base, nth(base.join("|"))]) });
          res.alerts.push(`${ticker}: grupamento em ${date} interpretado como posição final de ${e.qty} (fator = ${e.qty} ÷ posição anterior). Confira.`);
        }
        return;
      }
      skip(`${rule.label} só com crédito: não aplicado (lance manualmente se for evento real)`, entries.length);
      return;
    }
    if (!credits.length) {
      skip(`${rule.label} só com débito: não aplicado (lance manualmente informando o fator)`, entries.length);
      return;
    }
    const factor = sumC / sumD;
    if (Math.abs(factor - 1) < 1e-9) { skip(`${rule.label} sem efeito na quantidade (crédito = débito)`, entries.length); return; }
    pushTx({
      ...common, type: factor > 1 ? "SPLIT" : "REVERSE_SPLIT", quantity: Math.abs(sumC - sumD), unitPrice: 0, factor,
      externalId: hashParts([kind, date, ticker, "ADJ", rule.label, sumC, sumD]),
    });
    res.alerts.push(`${ticker}: ${rule.label} em ${date}: ${sumD} → ${sumC} (fator ${Number(factor.toPrecision(8))}).`);
  };

  for (const g of adjGroups.values()) emitAdjust(g.entries, g.rule, g.ticker, g.date);

  // ---- frações: débito de "Fração em Ativos" + crédito em dinheiro do "Leilão de Fração" (mesmo ativo e quantidade)
  const usedAuction = new Set<MovEntry>();
  const pushWriteoff = (e: MovEntry, date: string, proceeds: number) => {
    const base = [kind, date, e.ticker, "FRACTION_WRITEOFF", e.qty, proceeds];
    pushTx({
      ticker: e.ticker, assetClass: e.guess.assetClass, classConfident: e.guess.confident, type: "FRACTION_WRITEOFF", date,
      quantity: e.qty!, unitPrice: proceeds / e.qty!, source: kind, institution: e.inst, externalId: hashParts([...base, nth(base.join("|"))]),
    });
  };
  for (const d of fractionDebits) {
    const m = auctions.find((a) => !usedAuction.has(a) && a.ticker === d.ticker && a.date >= d.date && Math.abs(a.qty! - d.qty!) < 1e-6);
    if (m) usedAuction.add(m);
    const proceeds = m ? m.value ?? (m.price ?? 0) * m.qty! : 0;
    pushWriteoff(d, d.date, proceeds);
    res.alerts.push(m
      ? `${d.ticker}: baixa de fração de ${d.qty} em ${d.date}, leiloada em ${m.date} por R$ ${proceeds.toFixed(2)}.`
      : `${d.ticker}: baixa de fração de ${d.qty} em ${d.date} sem o "Leilão de Fração" correspondente na planilha (valor recebido = R$ 0,00).`);
  }
  for (const a of auctions) {
    if (usedAuction.has(a)) continue;
    const proceeds = a.value ?? (a.price ?? 0) * a.qty!;
    pushWriteoff(a, a.date, proceeds);
    res.alerts.push(`${a.ticker}: leilão de fração de ${a.qty} em ${a.date} (R$ ${proceeds.toFixed(2)}) sem a linha "Fração em Ativos" correspondente; baixa aplicada na data do leilão.`);
  }

  // ---- troca de ticker / incorporação / conversão de recibo
  for (const g of swapGroups.values()) {
    const debits = g.entries.filter((e) => !e.credit);
    const credits = g.entries.filter((e) => e.credit);
    const dT = [...new Set(debits.map((e) => e.ticker))];
    const cT = [...new Set(credits.map((e) => e.ticker))];
    if (dT.length === 1 && cT.length === 1 && dT[0] === cT[0]) { emitAdjust(g.entries, g.rule, dT[0], g.date); continue; }
    if (debits.length && credits.length) {
      const sumD = debits.reduce((a, e) => a + (e.qty ?? 0), 0);
      const sumC = credits.reduce((a, e) => a + (e.qty ?? 0), 0);
      if (dT.length === 1 && cT.length === 1 && sumD > 0 && sumC > 0) {
        const ratio = sumC / sumD;
        pushTx({
          ticker: dT[0], assetClass: debits[0].guess.assetClass, classConfident: debits[0].guess.confident, type: "TRANSFER_OUT",
          date: g.date, quantity: sumD, unitPrice: 0, factor: ratio, counterpartTicker: cT[0], source: kind, institution: debits[0].inst,
          externalId: hashParts([kind, g.date, "TRANSFER", dT[0], cT[0], sumD, sumC]),
        });
        res.alerts.push(`${dT[0]} → ${cT[0]} (${g.rule.label}, ${g.date}): ${sumD} → ${sumC}, razão ${Number(ratio.toPrecision(8))}. O ticker de origem será marcado como inativo.`);
      } else {
        res.issues.push({ row: g.entries[0].row, level: "warn", message: `${g.rule.label} em ${g.date} é ambígua (${dT.join(", ")} → ${cT.join(", ")}); lance manualmente em "Troca de ticker".` });
        skip(`${g.rule.label} ambígua: lance manualmente`, g.entries.length);
      }
      continue;
    }
    if (credits.length && g.rule.creditOnly === "buy") { // recibo de subscrição creditado = compra ao preço da subscrição
      for (const e of credits) {
        if (!e.qty || e.qty <= 0 || e.price == null || e.price <= 0) {
          res.issues.push({ row: e.row, level: "error", message: `${g.rule.label} de ${e.ticker} sem quantidade/preço para lançar a compra` });
          continue;
        }
        const base = [kind, g.date, "BUY", e.ticker, e.qty, e.price, e.inst, "RECIBO"];
        pushTx({
          ticker: e.ticker, assetClass: e.guess.assetClass, classConfident: e.guess.confident, type: "BUY", date: g.date,
          quantity: e.qty, unitPrice: e.price, source: kind, institution: e.inst, externalId: hashParts([...base, nth(base.join("|"))]),
        });
        res.alerts.push(`${e.ticker}: ${g.rule.label} lançado como compra de ${e.qty} a R$ ${e.price} em ${g.date}. Após a conversão, use "Troca de ticker" se ainda não houver.`);
      }
      continue;
    }
    skip(`${g.rule.label} sem contrapartida: lance manualmente em "Troca de ticker"`, g.entries.length);
  }

  // ---- resgate de ações resgatáveis de incorporação => redução de custo do ativo que recebeu a incorporação
  for (const e of redemptions) {
    const cands: string[] = [];
    for (const g of swapGroups.values()) {
      if (g.date > e.date || !g.entries.some((x) => x.credit && x.ticker === e.ticker)) continue;
      for (const x of g.entries) if (x.credit && x.ticker !== e.ticker && !cands.includes(x.ticker)) cands.push(x.ticker);
    }
    const amount = e.value!;
    if (!cands.length) {
      skip(`resgate de ${e.ticker} sem incorporação correspondente na planilha: lance em "Redução de custo"`);
      res.alerts.push(`${e.ticker}: resgate de R$ ${amount.toFixed(2)} em ${e.date} não foi aplicado (sem incorporação correspondente). Lance em "Redução de custo" no ativo que recebeu a incorporação.`);
      continue;
    }
    const base = [kind, e.date, "COST_REDUCTION", e.ticker, e.qty, amount];
    pushTx({
      ticker: cands[0], assetClass: e.guess.assetClass, classConfident: e.guess.confident, type: "COST_REDUCTION", date: e.date,
      quantity: e.qty!, unitPrice: amount / e.qty!, costTargets: cands, source: kind, institution: e.inst,
      externalId: hashParts([...base, nth(base.join("|"))]),
    });
    res.alerts.push(`${e.ticker}: resgate de R$ ${amount.toFixed(2)} em ${e.date} abaterá o custo do ativo da incorporação (candidatos: ${cands.join(", ")}).`);
  }
  return res;
}
