import type { EngineTransaction } from "./types.ts";

export const EPS = 1e-9;

export interface PositionState { quantity: number; totalCost: number }
export const EMPTY_STATE: PositionState = { quantity: 0, totalCost: 0 };

export const averagePrice = (s: PositionState): number =>
  s.quantity > EPS ? s.totalCost / s.quantity : 0;

export interface ApplyResult {
  state: PositionState;
  /** resultado realizado (vendas) */
  realizedPnL: number;
  /** fluxo externo: compra (+) / venda (−), já com custos e impostos */
  flow: number;
  warning?: string;
}

/**
 * Aplica uma operação ao estado da posição.
 * - BUY: custo += qtd*preço + custos; PM sobe/desce pela média ponderada.
 * - SELL / MATURITY / AMORTIZATION: baixa qtd ao PM vigente (PM não muda).
 * - SPLIT / REVERSE_SPLIT: qtd × fator, custo inalterado.
 * - BONUS: qtd += quantidade, custo += quantidade × unitPrice (custo atribuído).
 */
export function applyTransaction(state: PositionState, tx: EngineTransaction): ApplyResult {
  switch (tx.type) {
    case "BUY": {
      const cost = tx.quantity * tx.unitPrice + tx.fees;
      return {
        state: { quantity: state.quantity + tx.quantity, totalCost: state.totalCost + cost },
        realizedPnL: 0,
        flow: cost,
      };
    }
    case "SELL":
    case "MATURITY":
    case "AMORTIZATION": {
      let warning: string | undefined;
      let q = tx.quantity;
      if (q > state.quantity + EPS) {
        warning = `venda de ${q} excede posição de ${state.quantity}; limitada à posição`;
        q = state.quantity;
      }
      if (q <= EPS) return { state, realizedPnL: 0, flow: 0, warning: warning ?? "venda sem posição" };
      const pm = averagePrice(state);
      const proceeds = q * tx.unitPrice - tx.fees - tx.taxes;
      const remaining = state.quantity - q;
      const next: PositionState =
        remaining <= EPS ? EMPTY_STATE : { quantity: remaining, totalCost: state.totalCost - pm * q };
      return { state: next, realizedPnL: proceeds - pm * q, flow: -proceeds, warning };
    }
    case "SPLIT":
    case "REVERSE_SPLIT": {
      let k = tx.factor ?? null;
      if (k == null) {
        const delta = tx.type === "SPLIT" ? tx.quantity : -tx.quantity;
        k = state.quantity > EPS ? (state.quantity + delta) / state.quantity : 1;
      }
      return { state: { quantity: state.quantity * k, totalCost: state.totalCost }, realizedPnL: 0, flow: 0 };
    }
    case "BONUS": {
      return {
        state: {
          quantity: state.quantity + tx.quantity,
          totalCost: state.totalCost + tx.quantity * tx.unitPrice,
        },
        realizedPnL: 0,
        flow: 0,
      };
    }
  }
}
