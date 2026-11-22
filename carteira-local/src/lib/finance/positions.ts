import { applyTransaction, applyTransferIn, averagePrice, EMPTY_STATE, EPS, typeRank } from "./average-price.ts";
import { isPlausibleSplitFactor } from "./corporate.ts";
import type { PositionState } from "./average-price.ts";
import { effectiveIndex } from "./dates.ts";
import type { DayKey } from "./dates.ts";
import { buildFixedIncomeIndex } from "./fixed-income.ts";
import type { RateArrays } from "./fixed-income.ts";
import type { EngineAsset, EngineInput, EngineTransaction, PositionPoint } from "./types.ts";

export interface PositionsResult {
  points: PositionPoint[];
  marketValue: Float64Array;
  cost: Float64Array;
  flow: Float64Array;
  /** caixa recebido que permanece na carteira (redução de custo) */
  cashIn: Float64Array;
  realizedPnL: Map<string, number>;
  warnings: string[];
}

interface Lot { idx: number; principal: number; frac: number }
/** Evento de um ativo: operação do livro OU entrada de posição vinda de outro ativo (troca de ticker). */
interface Entry { idx: number; order: number; tx: EngineTransaction | null; inbound: { qty: number; cost: number } | null }

const isReducing = (t: EngineTransaction["type"]) =>
  t === "SELL" || t === "MATURITY" || t === "AMORTIZATION" || t === "FRACTION_WRITEOFF";
/** Ordem dentro do mesmo dia: entrada de troca primeiro; depois a ordem lógica dos eventos (ver `typeRank`). */
const rank = (e: Entry) => (e.inbound ? 0 : typeRank(e.tx!.type));

/** Ativos de origem de uma troca são processados antes dos de destino (ordem topológica). */
function orderAssets(assets: EngineAsset[], transactions: EngineTransaction[], warnings: string[]): EngineAsset[] {
  const ids = new Set(assets.map((a) => a.id));
  const indeg = new Map<string, number>(assets.map((a) => [a.id, 0]));
  const next = new Map<string, string[]>();
  for (const t of transactions) {
    const cp = t.counterpartAssetId;
    if (t.type !== "TRANSFER_OUT" || !cp || cp === t.assetId || !ids.has(cp) || !ids.has(t.assetId)) continue;
    (next.get(t.assetId) ?? next.set(t.assetId, []).get(t.assetId)!).push(cp);
    indeg.set(cp, (indeg.get(cp) ?? 0) + 1);
  }
  const queue = assets.filter((a) => (indeg.get(a.id) ?? 0) === 0);
  const out: EngineAsset[] = [];
  const byId = new Map(assets.map((a) => [a.id, a]));
  while (queue.length) {
    const a = queue.shift()!;
    out.push(a);
    for (const to of next.get(a.id) ?? []) {
      indeg.set(to, indeg.get(to)! - 1);
      if (indeg.get(to) === 0) queue.push(byId.get(to)!);
    }
  }
  if (out.length < assets.length) {
    warnings.push("ciclo em trocas de ticker detectado; verifique os lançamentos de troca");
    for (const a of assets) if (!out.includes(a)) out.push(a);
  }
  return out;
}

export function computePositions(input: EngineInput, calendar: DayKey[], rates: RateArrays): PositionsResult {
  const n = calendar.length;
  const marketValue = new Float64Array(n);
  const cost = new Float64Array(n);
  const flow = new Float64Array(n);
  const cashIn = new Float64Array(n);
  const points: PositionPoint[] = [];
  const realizedPnL = new Map<string, number>();
  const warnings: string[] = [];

  const byAsset = new Map<string, EngineTransaction[]>();
  for (const t of input.transactions) {
    const l = byAsset.get(t.assetId) ?? [];
    l.push(t);
    byAsset.set(t.assetId, l);
  }
  const futureTx = input.transactions.filter((t) => t.date > input.endDate).length;
  if (futureTx) warnings.push(`${futureTx} lançamento(s) com data posterior a ${input.endDate} foram ignorados no cálculo`);
  const known = new Set(input.assets.map((a) => a.id));
  const inbound = new Map<string, Entry[]>();
  let seq = 0;

  for (const asset of orderAssets(input.assets, input.transactions, warnings)) {
    const own: Entry[] = (byAsset.get(asset.id) ?? [])
      .map((tx, order) => ({ tx, order, idx: effectiveIndex(calendar, tx.date, input.endDate), inbound: null }))
      .filter((e) => e.idx >= 0);
    const entries = [...own, ...(inbound.get(asset.id) ?? [])];
    if (!entries.length) continue;
    entries.sort((a, b) => a.idx - b.idx || rank(a) - rank(b) || a.order - b.order);
    const start = entries[0].idx;

    const fixedClass = asset.assetClass === "RENDA_FIXA" || asset.assetClass === "TESOURO";
    if (fixedClass && !asset.fixedIncome) warnings.push(`${asset.ticker}: renda fixa sem condições contratadas; valorizada a custo`);
    const fi = fixedClass && asset.fixedIncome ? buildFixedIncomeIndex(asset.fixedIncome, calendar, rates) : null;

    // ---- 1) estado (quantidade e custo) dia a dia; independe de preços
    const qtyArr = new Float64Array(n);
    const costArr = new Float64Array(n);
    const fiValue = fi ? new Float64Array(n) : null;
    const splitK = new Map<number, number>(); // dia -> fator de desdobramento/grupamento
    const lots: Lot[] = [];
    let state: PositionState = EMPTY_STATE;
    let e = 0;
    for (let i = start; i < n; i++) {
      while (e < entries.length && entries[e].idx === i) {
        const en = entries[e++];
        if (en.inbound) { state = applyTransferIn(state, en.inbound.qty, en.inbound.cost); continue; }
        const tx = en.tx!;
        const before = state;
        const res = applyTransaction(state, tx);
        state = res.state;
        flow[i] += res.flow;
        if (res.cashIn) cashIn[i] += res.cashIn;
        if (res.realizedPnL) realizedPnL.set(asset.id, (realizedPnL.get(asset.id) ?? 0) + res.realizedPnL);
        if (res.warning) warnings.push(`${asset.ticker} ${tx.date}: ${res.warning}`);
        if (tx.type === "SPLIT" || tx.type === "REVERSE_SPLIT" || tx.type === "REGROUP") {
          const k = before.quantity > EPS ? state.quantity / before.quantity : tx.factor ?? 1;
          // fator explícito sempre ajusta cotações; fator derivado só se for uma razão de desdobramento plausível
          if (Math.abs(k - 1) > 1e-12 && (tx.factor != null || isPlausibleSplitFactor(k))) splitK.set(i, (splitK.get(i) ?? 1) * k);
        }
        if (res.transferred) {
          const cp = tx.counterpartAssetId;
          if (!cp || cp === asset.id || !known.has(cp)) {
            warnings.push(`${asset.ticker} ${tx.date}: troca de ticker sem ativo de destino válido; posição baixada sem destino`);
          } else {
            const dest = inbound.get(cp) ?? [];
            dest.push({ idx: i, order: seq++, tx: null, inbound: { qty: res.transferred.quantity * (tx.factor ?? 1), cost: res.transferred.cost } });
            inbound.set(cp, dest);
          }
        }
        if (fi) {
          if (tx.type === "BUY") {
            lots.push({ idx: i, principal: tx.quantity * tx.unitPrice + tx.fees, frac: 1 });
          } else if (isReducing(tx.type)) {
            const f = before.quantity > EPS ? Math.min(1, tx.quantity / before.quantity) : 0;
            for (const l of lots) l.frac *= 1 - f;
            if (state.quantity <= EPS) lots.length = 0;
          }
        }
      }
      qtyArr[i] = state.quantity;
      costArr[i] = state.totalCost;
      if (fi && state.quantity > EPS) {
        let v = 0;
        for (const l of lots) v += (l.principal * l.frac * fi[i]) / fi[l.idx];
        fiValue![i] = v;
      }
    }

    // ---- 2) valorização
    // Cotações de provedores vêm ajustadas por desdobramentos FUTUROS: devolve-se a base negociada
    // multiplicando pelos fatores dos eventos do livro posteriores ao dia (ledger em termos reais).
    const adj = new Float64Array(n).fill(1);
    if (input.splitAdjustedQuotes !== false && splitK.size) {
      let cum = 1;
      for (let i = n - 1; i >= 0; i--) {
        adj[i] = cum;
        const k = splitK.get(i);
        if (k) cum *= k;
      }
    }
    const quotes = [...(input.quotes[asset.id] ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1));
    let qp = -1;
    for (let i = start; i < n; i++) {
      const q = qtyArr[i];
      if (q <= EPS) continue;
      const pm = averagePrice({ quantity: q, totalCost: costArr[i] });
      let value: number, price: number, source: PositionPoint["priceSource"];
      if (fi) {
        value = fiValue![i];
        price = value / q;
        source = "CURVE";
      } else {
        while (qp + 1 < quotes.length && quotes[qp + 1].date <= calendar[i]) qp++;
        if (qp >= 0) { price = quotes[qp].close * adj[i]; source = "QUOTE"; }
        else { price = pm; source = "COST"; }
        value = q * price;
      }
      marketValue[i] += value;
      cost[i] += costArr[i];
      points.push({ assetId: asset.id, date: calendar[i], quantity: q, averagePrice: pm, price, marketValue: value, priceSource: source });
    }
  }
  return { points, marketValue, cost, flow, cashIn, realizedPnL, warnings };
}
