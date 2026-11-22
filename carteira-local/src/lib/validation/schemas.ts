import { z } from "zod";
import { INDEXERS, PROVENTO_TYPES } from "../finance/constants";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data inválida (use AAAA-MM-DD)");
const num = z.coerce.number({ invalid_type_error: "número inválido" });
const emptyToUndef = (v: unknown) => (v === "" || v === null ? undefined : v);
const ticker = z.string().trim().min(1, "informe o ativo").transform((s) => s.toUpperCase());

export const manualEntrySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("RENDA_VARIAVEL"),
    ticker, assetClass: z.enum(["ACAO", "FII", "ETF", "BDR"]), type: z.enum(["BUY", "SELL"]),
    date: day, quantity: num.positive("quantidade deve ser > 0"), unitPrice: num.min(0), fees: z.preprocess(emptyToUndef, num.min(0).default(0)),
  }),
  z.object({
    kind: z.literal("RENDA_FIXA"),
    name: z.string().trim().min(2, "informe o nome do título"),
    assetClass: z.enum(["RENDA_FIXA", "TESOURO"]), indexer: z.enum(INDEXERS), rate: num.min(0),
    maturityDate: day, issuer: z.preprocess(emptyToUndef, z.string().trim().optional()),
    isTaxExempt: z.boolean().default(false),
    type: z.enum(["BUY", "RESGATE_TOTAL"]), date: day, amount: num.positive("valor deve ser > 0"),
  }),
  z.object({
    kind: z.literal("DESDOBRAMENTO"),
    ticker, type: z.enum(["SPLIT", "REVERSE_SPLIT"]), date: day, factor: num.positive("fator deve ser > 0"),
  }),
  z.object({
    kind: z.literal("TROCA_TICKER"),
    fromTicker: ticker, toTicker: ticker, date: day,
    ratio: z.preprocess(emptyToUndef, num.positive("razão deve ser > 0").default(1)),
    /** vazio = toda a posição (e o ticker de origem fica inativo) */
    quantity: z.preprocess(emptyToUndef, num.positive().optional()),
  }),
  z.object({
    kind: z.literal("REDUCAO_CUSTO"),
    ticker, date: day,
    /** valor recebido em dinheiro (resgate/amortização em incorporação); abate o custo total do ativo */
    amount: num.positive("valor deve ser > 0"),
    /** quantidade resgatada (informativa); vazio = 1 */
    quantity: z.preprocess(emptyToUndef, num.positive().optional()),
  }),
  z.object({
    kind: z.literal("BAIXA_FRACAO"),
    ticker, date: day,
    /** vazio = parte fracionária atual da posição */
    quantity: z.preprocess(emptyToUndef, num.positive().optional()),
    /** valor total recebido no leilão (pode ser 0) */
    proceeds: z.preprocess(emptyToUndef, num.min(0).default(0)),
  }),
]);
export type ManualEntry = z.infer<typeof manualEntrySchema>;

export const manualProventoSchema = z.object({
  ticker, type: z.enum(PROVENTO_TYPES), paymentDate: day,
  comDate: z.preprocess(emptyToUndef, day.optional()),
  quantity: z.preprocess(emptyToUndef, num.positive().optional()),
  grossAmount: num.positive("valor bruto deve ser > 0"),
  taxWithheld: z.preprocess(emptyToUndef, num.min(0).default(0)),
}).refine((p) => p.taxWithheld <= p.grossAmount, { message: "IR não pode exceder o valor bruto", path: ["taxWithheld"] });
export type ManualProvento = z.infer<typeof manualProventoSchema>;

/** Edição parcial de um lançamento existente (campos vazios = manter). */
export const editTransactionSchema = z.object({
  date: z.preprocess(emptyToUndef, day.optional()),
  quantity: z.preprocess(emptyToUndef, num.min(0).optional()),
  unitPrice: z.preprocess(emptyToUndef, num.min(0).optional()),
  fees: z.preprocess(emptyToUndef, num.min(0).optional()),
  factor: z.preprocess(emptyToUndef, num.positive().optional()),
});
