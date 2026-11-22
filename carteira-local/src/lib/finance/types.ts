import type { Indexer, TransactionType } from "./constants.ts";
import type { DayKey } from "./dates.ts";

export interface FixedIncomeTerms {
  indexer: Indexer;
  /** CDI_PERCENT: 110 = 110% do CDI. Demais: % a.a. */
  rate: number;
  maturityDate?: DayKey | null;
}

export interface EngineAsset {
  id: string;
  ticker: string;
  assetClass: string;
  fixedIncome?: FixedIncomeTerms | null;
}

export interface EngineTransaction {
  assetId: string;
  type: TransactionType;
  date: DayKey;
  quantity: number;
  unitPrice: number;
  fees: number;
  taxes: number;
  factor?: number | null;
  /** TRANSFER_OUT: ativo que recebe a posição (qtd × factor, mesmo custo total) */
  counterpartAssetId?: string | null;
}

export interface EngineProvento {
  assetId: string;
  paymentDate: DayKey;
  netAmount: number;
}

export interface QuotePoint { date: DayKey; close: number }
export interface BenchmarkPoint { date: DayKey; value: number }

export interface EngineInput {
  assets: EngineAsset[];
  transactions: EngineTransaction[];
  proventos: EngineProvento[];
  /** assetId -> cotações (as cotações do Yahoo vêm ajustadas por desdobramentos) */
  quotes: Record<string, QuotePoint[]>;
  benchmarks: { cdi?: BenchmarkPoint[]; selic?: BenchmarkPoint[]; ipca?: BenchmarkPoint[] };
  endDate: DayKey;
  /** padrão true: cotações vêm ajustadas por desdobramentos; o motor as devolve à base negociada na data (× fatores futuros do livro) */
  splitAdjustedQuotes?: boolean;
}

export type PriceSource = "QUOTE" | "COST" | "CURVE";

export interface PositionPoint {
  assetId: string;
  date: DayKey;
  quantity: number;
  averagePrice: number;
  price: number;
  marketValue: number;
  priceSource: PriceSource;
}

export interface PortfolioRow {
  date: DayKey;
  marketValue: number;
  provCash: number;
  totalValue: number;
  netFlow: number;
  investedCost: number;
}

export interface PortfolioPoint extends PortfolioRow {
  dailyReturn: number;
  quota: number;
}
