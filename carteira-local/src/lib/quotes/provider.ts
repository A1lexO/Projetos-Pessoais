export type SecurityRef = { kind: "equity"; ticker: string } | { kind: "ibov" };
export interface HistoryPoint { date: string; close: number }

export interface QuoteProvider {
  name: string;
  isConfigured(): boolean;
  /** from/to em YYYY-MM-DD (UTC). Fechamentos diários ajustados por desdobramento. */
  fetchHistory(ref: SecurityRef, from: string, to: string): Promise<HistoryPoint[]>;
}
