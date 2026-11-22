import type { TransactionType } from "./constants.ts";
import type { EngineTransaction } from "./types.ts";

export const EPS = 1e-9;

/**
 * Ordem dos eventos de um mesmo ativo no mesmo dia (menor primeiro). O que a B3 lista junto em um evento
 * corporativo precisa ser aplicado em sequência lógica: grupamento -> baixa da fração -> desdobramento -> compras -> vendas -> troca.
 * Ex.: CASH3 em 02/06/2023 (256 -> 2,56 -> 2 -> 20).
 */
const ORDER: Record<TransactionType, number> = {
  REVERSE_SPLIT: 1, REGROUP: 1, FRACTION_WRITEOFF: 2, SPLIT: 3, BONUS: 3, BUY: 4,
  SELL: 5, MATURITY: 5, AMORTIZATION: 5, COST_REDUCTION: 5, TRANSFER_OUT: 6,
};
export const typeRank = (t: TransactionType): number => ORDER[t];

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
  /** dinheiro recebido que fica na carteira como caixa (não é aporte nem resgate): redução de custo */
  cashIn?: number;
  /** TRANSFER_OUT: quantidade e custo que saíram deste ativo (o motor os entrega ao destino) */
  transferred?: { quantity: number; cost: number };
}

/** Entrada de posição vinda de outro ativo (troca de ticker / conversão): soma quantidade e custo. */
export const applyTransferIn = (s: PositionState, quantity: number, cost: number): PositionState => ({
  quantity: s.quantity + quantity,
  totalCost: s.totalCost + cost,
});

/**
 * Aplica uma operação ao estado da posição.
 * - BUY: custo += qtd*preço + custos; PM sobe/desce pela média ponderada.
 * - SELL / MATURITY / AMORTIZATION / FRACTION_WRITEOFF: baixa qtd ao PM vigente (PM não muda);
 *   o que entrou em caixa (qtd × preço − custos) é fluxo de saída.
 * - SPLIT / REVERSE_SPLIT: qtd × fator (ou derivado da qtd creditada/debitada), custo inalterado.
 * - BONUS: qtd += quantidade, custo += quantidade × unitPrice (custo atribuído).
 * - COST_REDUCTION: abate `quantidade × unitPrice` do custo total (quantidade intacta, PM cai); o valor vira caixa.
 *   Se exceder o custo, o excedente é resultado realizado e o custo zera.
 * - REGROUP: grupamento informado só pelo crédito: a posição passa a ser `quantity` (fator = quantity ÷ posição anterior), custo inalterado.
 *   Crédito maior ou igual à posição anterior não é um grupamento: é ignorado com aviso.
 * - TRANSFER_OUT: tira `quantity` (0 = tudo) ao PM vigente, sem fluxo e sem resultado.
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
    case "AMORTIZATION":
    case "FRACTION_WRITEOFF": {
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
    case "REGROUP": {
      if (state.quantity <= EPS || tx.quantity <= EPS || tx.quantity >= state.quantity - EPS) {
        return { state, realizedPnL: 0, flow: 0, warning: `grupamento para ${tx.quantity} incompatível com a posição anterior de ${state.quantity}; ignorado` };
      }
      return { state: { quantity: tx.quantity, totalCost: state.totalCost }, realizedPnL: 0, flow: 0 };
    }
    case "COST_REDUCTION": {
      const amount = Math.max(0, tx.quantity * tx.unitPrice - tx.fees - tx.taxes);
      if (state.quantity <= EPS) {
        return { state, realizedPnL: 0, flow: 0, cashIn: amount, warning: "redução de custo sem posição no ativo; valor recebido entrou no caixa" };
      }
      const reduced = state.totalCost - amount;
      if (reduced >= 0) return { state: { quantity: state.quantity, totalCost: reduced }, realizedPnL: 0, flow: 0, cashIn: amount };
      return { state: { quantity: state.quantity, totalCost: 0 }, realizedPnL: -reduced, flow: 0, cashIn: amount };
    }
    case "TRANSFER_OUT": {
      if (state.quantity <= EPS) return { state, realizedPnL: 0, flow: 0, warning: "troca de ticker sem posição no ativo de origem" };
      const q = tx.quantity > EPS ? Math.min(tx.quantity, state.quantity) : state.quantity;
      const cost = averagePrice(state) * q;
      const remaining = state.quantity - q;
      return {
        state: remaining <= EPS ? EMPTY_STATE : { quantity: remaining, totalCost: state.totalCost - cost },
        realizedPnL: 0,
        flow: 0,
        transferred: { quantity: q, cost },
      };
    }
  }
}
