// =============================================================================
// CONFIGURAÇÃO DO IMPORTADOR DA B3  — edite aqui se a B3 mudar nomes de colunas/tipos.
// Regras de escrita:
//  - Aliases e `match` em MINÚSCULAS e SEM ACENTO ("preço unitário" -> "preco unitario").
//    A comparação ignora acentos, caixa e espaços repetidos nos cabeçalhos da planilha.
//  - Para cada campo vale o PRIMEIRO alias encontrado no arquivo.
// Layouts assumidos (Área do Investidor > Extratos), a validar com sua planilha real:
//  - Negociação:   Data do Negócio | Tipo de Movimentação | Mercado | Prazo/Vencimento |
//                  Instituição | Código de Negociação | Quantidade | Preço | Valor
//  - Movimentação: Entrada/Saída | Data | Movimentação | Produto | Instituição |
//                  Quantidade | Preço unitário | Valor da Operação
// =============================================================================
import type { ProventoType } from "../lib/finance/constants.ts";

export const B3_COLUMNS = {
  negociacao: {
    date: ["data do negocio", "data negocio", "data"],
    type: ["tipo de movimentacao", "tipo movimentacao", "operacao"],
    market: ["mercado"],
    institution: ["instituicao", "corretora"],
    ticker: ["codigo de negociacao", "codigo", "ativo"],
    quantity: ["quantidade"],
    price: ["preco", "preco unitario"],
    value: ["valor", "valor da operacao"],
  },
  movimentacao: {
    direction: ["entrada/saida", "entrada saida"],
    date: ["data"],
    type: ["movimentacao"],
    product: ["produto"],
    institution: ["instituicao"],
    quantity: ["quantidade"],
    price: ["preco unitario", "preco"],
    value: ["valor da operacao", "valor"],
  },
} as const;

/** Negociação: texto da coluna "Tipo de Movimentação" -> tipo de operação. */
export const NEGOCIACAO_TYPES: Record<string, "BUY" | "SELL"> = { compra: "BUY", venda: "SELL" };

export type MovRuleTarget =
  | { kind: "provento"; type: ProventoType }
  /** crédito de ações sem contrapartida (bonificação): vira BONUS com custo = preço unitário */
  | { kind: "corporate"; type: "BONUS" }
  /**
   * Ajuste de quantidade do MESMO ativo (desdobramento, grupamento, atualização). Linhas do mesmo
   * ativo/dia são agrupadas: crédito e débito => fator = créditos ÷ débitos (explícito, não depende do
   * seu histórico); só crédito => `creditOnly` decide: "split" soma a quantidade creditada à posição mantendo o
   * custo total (PM cai; o fator só ajusta cotações se for uma razão de desdobramento plausível); "regroup" trata
   * o crédito como a POSIÇÃO FINAL do grupamento (a B3 informa só o crédito: 256 → 2,56); "skip" não aplica, avisa.
   */
  | { kind: "qty_adjust"; label: string; creditOnly: "split" | "regroup" | "skip" }
  /**
   * Troca de ticker / incorporação / conversão de recibo: débito num ticker e crédito em outro, no mesmo
   * dia e mesmo tipo => TRANSFER_OUT (razão = crédito ÷ débito). Só crédito: `creditOnly` "buy" lança
   * compra ao preço da linha (recibo de subscrição); "skip" avisa para lançar manualmente.
   */
  | { kind: "swap"; label: string; creditOnly: "buy" | "skip" }
  /**
   * Resgate de ações resgatáveis recebidas numa incorporação (ex.: C9BS4 na fusão Petz/Cobasi). O crédito em dinheiro
   * abate o custo do ativo que recebeu a incorporação (COST_REDUCTION). O ativo de destino é achado pelo grupo de
   * "Incorporação" que creditou o mesmo ticker; se não houver, o resgate não é aplicado (lance em "Redução de custo").
   */
  | { kind: "redemption" }
  /**
   * Leilão de fração (a B3 lista o dinheiro como CRÉDITO, com a quantidade da fração). É pareado com o débito de
   * "Fração em Ativos" do mesmo ativo e quantidade => um único FRACTION_WRITEOFF na data do débito, com o valor do leilão.
   */
  | { kind: "fraction_auction" }
  /** "Fração em Ativos": crédito => BONUS de custo zero; débito => baixa da fração (pareada com o leilão) */
  | { kind: "fraction_credit" }
  /** Restituição de capital: o crédito em dinheiro abate o custo do próprio ativo (COST_REDUCTION); a quantidade da B3 é informativa */
  | { kind: "capital_return" }
  | { kind: "trade" }
  | { kind: "skip"; reason: string };

/**
 * Movimentação: primeira regra cujo `match` esteja CONTIDO no texto da coluna "Movimentação" vence.
 * Ordem importa (específicas antes das genéricas). Tipos sem regra são ignorados e listados na prévia.
 */
export const MOVIMENTACAO_RULES: { match: string; target: MovRuleTarget }[] = [
  { match: "juros sobre capital proprio", target: { kind: "provento", type: "JCP" } },
  { match: "dividendo", target: { kind: "provento", type: "DIVIDENDO" } },
  { match: "rendimento", target: { kind: "provento", type: "RENDIMENTO" } },
  { match: "amortizacao", target: { kind: "provento", type: "AMORTIZACAO" } },
  { match: "recibo de subscricao", target: { kind: "swap", label: "recibo de subscrição", creditOnly: "buy" } },
  { match: "incorporacao", target: { kind: "swap", label: "incorporação", creditOnly: "skip" } },
  { match: "fusao", target: { kind: "swap", label: "fusão", creditOnly: "skip" } },
  { match: "conversao", target: { kind: "swap", label: "conversão", creditOnly: "skip" } },
  { match: "substituicao", target: { kind: "swap", label: "substituição de ticker", creditOnly: "skip" } },
  { match: "troca de ticker", target: { kind: "swap", label: "troca de ticker", creditOnly: "skip" } },
  { match: "desdobramento", target: { kind: "qty_adjust", label: "desdobramento", creditOnly: "split" } },
  { match: "desdobro", target: { kind: "qty_adjust", label: "desdobro", creditOnly: "split" } },
  { match: "grupamento", target: { kind: "qty_adjust", label: "grupamento", creditOnly: "regroup" } },
  { match: "restituicao de capital", target: { kind: "capital_return" } },
  { match: "atualizacao", target: { kind: "qty_adjust", label: "atualização", creditOnly: "skip" } },
  { match: "bonificacao", target: { kind: "corporate", type: "BONUS" } },
  { match: "leilao de fracao", target: { kind: "fraction_auction" } },
  { match: "fracao em ativos", target: { kind: "fraction_credit" } },
  { match: "resgate", target: { kind: "redemption" } },
  { match: "transferencia - liquidacao", target: { kind: "trade" } },
  { match: "compra", target: { kind: "trade" } },
  { match: "venda", target: { kind: "trade" } },
  { match: "transferencia", target: { kind: "skip", reason: "transferência de custódia (sem efeito na carteira)" } },
];

export const IMPORT_OPTIONS = {
  /**
   * Compras/vendas aparecem na Negociação E (como "Transferência - Liquidação") na Movimentação.
   * Para não contar duas vezes, a Movimentação ignora negócios por padrão.
   * Ponha true só se você NÃO importa a planilha de Negociação.
   */
  importTradesFromMovimentacao: false,
  /** Mercados da Negociação ignorados (texto normalizado contido na coluna "Mercado"). */
  skipMarkets: ["opcao", "opcoes", "termo", "futuro"],
  /** Tickers de ETFs conhecidos (sufixo 11 é ambíguo entre FII, ETF e units). */
  knownEtfs: ["BOVA11", "IVVB11", "SMAL11", "BOVV11", "DIVO11", "HASH11", "GOLD11", "NASD11", "SPXI11", "MATB11", "FIND11", "GOVE11", "PIBB11", "ECOO11", "BOVX11", "XFIX11", "IMAB11", "B5P211"],
  /** Tickers sufixo 11 que são units de ações, não FIIs. */
  knownUnits: ["TAEE11", "KLBN11", "SANB11", "BPAC11", "ALUP11", "SAPR11", "ENGI11", "CPLE11", "BRBI11", "SULA11"],
};
