// Domínios "string-enum" do schema. Validados com Zod na borda (API/importação).

export const ASSET_CLASSES = ["ACAO", "FII", "ETF", "BDR", "RENDA_FIXA", "TESOURO", "FUNDO", "CRIPTO", "OUTRO"] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

// TRANSFER_OUT: troca de ticker / incorporação / conversão de recibo (posição e custo vão para `counterpartAssetId`, qtd × `factor`).
// REGROUP: grupamento informado só como crédito: `quantity` é a POSIÇÃO FINAL (fator = quantity ÷ posição anterior).
// COST_REDUCTION: redução de custo (resgate/amortização em incorporação): o valor recebido (qtd × unitPrice) entra no caixa e abate o custo
// total do ativo, sem mudar a quantidade (o PM cai).
// FRACTION_WRITEOFF: baixa de fração residual (leilão de frações); o valor recebido entra como `unitPrice`.
export const TRANSACTION_TYPES = ["BUY", "SELL", "SPLIT", "REVERSE_SPLIT", "BONUS", "MATURITY", "AMORTIZATION", "TRANSFER_OUT", "FRACTION_WRITEOFF", "COST_REDUCTION", "REGROUP"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const PROVENTO_TYPES = ["DIVIDENDO", "JCP", "RENDIMENTO", "AMORTIZACAO", "OUTRO"] as const;
export type ProventoType = (typeof PROVENTO_TYPES)[number];

export const INDEXERS = ["CDI_PERCENT", "CDI_SPREAD", "IPCA_SPREAD", "PREFIXADO", "SELIC"] as const;
export type Indexer = (typeof INDEXERS)[number];

export const BENCHMARK_CODES = ["CDI", "IPCA", "IBOV", "SELIC"] as const;
export type BenchmarkCode = (typeof BENCHMARK_CODES)[number];
