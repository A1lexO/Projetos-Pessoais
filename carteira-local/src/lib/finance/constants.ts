// Domínios "string-enum" do schema. Validados com Zod na borda (API/importação).

export const ASSET_CLASSES = ["ACAO", "FII", "ETF", "BDR", "RENDA_FIXA", "TESOURO", "FUNDO", "CRIPTO", "OUTRO"] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

export const TRANSACTION_TYPES = ["BUY", "SELL", "SPLIT", "REVERSE_SPLIT", "BONUS", "MATURITY", "AMORTIZATION"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const PROVENTO_TYPES = ["DIVIDENDO", "JCP", "RENDIMENTO", "AMORTIZACAO", "OUTRO"] as const;
export type ProventoType = (typeof PROVENTO_TYPES)[number];

export const INDEXERS = ["CDI_PERCENT", "CDI_SPREAD", "IPCA_SPREAD", "PREFIXADO", "SELIC"] as const;
export type Indexer = (typeof INDEXERS)[number];

export const BENCHMARK_CODES = ["CDI", "IPCA", "IBOV", "SELIC"] as const;
export type BenchmarkCode = (typeof BENCHMARK_CODES)[number];
