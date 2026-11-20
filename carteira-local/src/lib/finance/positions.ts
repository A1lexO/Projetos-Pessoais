import { applyTransaction, averagePrice, EMPTY_STATE, EPS } from "./average-price.ts";
import type { PositionState } from "./average-price.ts";
import { nextIndexOnOrAfter } from "./dates.ts";
import type { DayKey } from "./dates.ts";
import { buildFixedIncomeIndex } from "./fixed-income.ts";
import type { RateArrays } from "./fixed-income.ts";
import type { EngineInput, EngineTransaction, PositionPoint } from "./types.ts";

export interface PositionsResult {
  points: PositionPoint[];
  marketValue: Float64Array;
  cost: Float64Array;
  flow: Float64Array;
  realizedPnL: Map<string, number>;
  warnings: string[];
}

interface Lot { idx: number; principal: number; frac: number }

const isReducing = (t: EngineTransaction["type"]) =>
  t === "SELL" || t === "MATURITY" || t === "AMORTIZATION";
const typeRank = (t: EngineTransaction["type"]) => (isReducing(t) ? 1 : 0);

export function computePositions(
  input: EngineInput & { transactions: EngineTransaction[] },
  calendar: DayKey[],
  rates: RateArrays,
): PositionsResult {
  const n = calendar.length;
  const marketValue = new Float64Array(n);
  const cost = new Float64Array(n);
  const flow = new Float64Array(n);
  const points: PositionPoint[] = [];
  const realizedPnL = new Map<string, number>();
  const warnings: string[] = [];

  const byAsset = new Map<string, EngineTransaction[]>();
  for (const t of input.transactions) {
    const l = byAsset.get(t.assetId) ?? [];
    l.push(t);
    byAsset.set(t.assetId, l);
  }

  for (const asset of input.assets) {
    const events = (byAsset.get(asset.id) ?? [])
      .map((tx, order) => ({ tx, order, idx: nextIndexOnOrAfter(calendar, tx.date) }))
      .filter((e) => e.idx >= 0);
    if (!events.length) continue;
    events.sort((a, b) => a.idx - b.idx || typeRank(a.tx.type) - typeRank(b.tx.type) || a.order - b.order);

    const fixedClass = asset.assetClass === "RENDA_FIXA" || asset.assetClass === "TESOURO";
    if (fixedClass && !asset.fixedIncome) warnings.push(`${asset.ticker}: renda fixa sem condições contratadas; valorizada a custo`);
    const fi = fixedClass && asset.fixedIncome ? buildFixedIncomeIndex(asset.fixedIncome, calendar, rates) : null;

    const quotes = [...(input.quotes[asset.id] ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1));
    let qp = -1;
    let state: PositionState = EMPTY_STATE;
    const lots: Lot[] = [];
    let e = 0;

    for (let i = events[0].idx; i < n; i++) {
      while (e < events.length && events[e].idx === i) {
        const tx = events[e].tx;
        e++;
        const before = state;
        const res = applyTransaction(state, tx);
        state = res.state;
        flow[i] += res.flow;
        if (res.realizedPnL) realizedPnL.set(asset.id, (realizedPnL.get(asset.id) ?? 0) + res.realizedPnL);
        if (res.warning) warnings.push(`${asset.ticker} ${tx.date}: ${res.warning}`);
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
      if (state.quantity <= EPS) continue;

      const pm = averagePrice(state);
      let value: number, price: number, source: PositionPoint["priceSource"];
      if (fi) {
        value = 0;
        for (const l of lots) value += (l.principal * l.frac * fi[i]) / fi[l.idx];
        price = value / state.quantity;
        source = "CURVE";
      } else {
        while (qp + 1 < quotes.length && quotes[qp + 1].date <= calendar[i]) qp++;
        if (qp >= 0) { price = quotes[qp].close; source = "QUOTE"; }
        else { price = pm; source = "COST"; }
        value = state.quantity * price;
      }
      marketValue[i] += value;
      cost[i] += state.totalCost;
      points.push({ assetId: asset.id, date: calendar[i], quantity: state.quantity, averagePrice: pm, price, marketValue: value, priceSource: source });
    }
  }
  return { points, marketValue, cost, flow, realizedPnL, warnings };
}
