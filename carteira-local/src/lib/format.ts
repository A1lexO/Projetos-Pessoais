export const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const num = (n: number, d = 2) => n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: d });
export const pct = (n: number | null | undefined, d = 2) =>
  n == null || !Number.isFinite(n) ? "—" : `${(n * 100).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d })}%`;
export const dateBR = (k: string) => k.split("-").reverse().join("/");
export const tone = (n: number) => (n >= 0 ? "text-accent" : "text-negative");

export const CLASS_LABELS: Record<string, string> = {
  ACAO: "Ações", FII: "FIIs", ETF: "ETFs", BDR: "BDRs", RENDA_FIXA: "Renda Fixa", TESOURO: "Tesouro Direto", FUNDO: "Fundos", CRIPTO: "Cripto", OUTRO: "Outros",
};
export const TYPE_LABELS: Record<string, string> = {
  BUY: "Compra", SELL: "Venda", SPLIT: "Desdobramento", REVERSE_SPLIT: "Grupamento", BONUS: "Bonificação", MATURITY: "Vencimento", AMORTIZATION: "Amortização", TRANSFER_OUT: "Troca de ticker", FRACTION_WRITEOFF: "Baixa de fração", COST_REDUCTION: "Redução de custo", REGROUP: "Grupamento (posição final)",
  DIVIDENDO: "Dividendo", JCP: "JCP", RENDIMENTO: "Rendimento", AMORTIZACAO: "Amortização",
};
