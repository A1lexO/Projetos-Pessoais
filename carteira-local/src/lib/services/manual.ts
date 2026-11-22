import { prisma } from "../db/prisma";
import { HttpError } from "../api";
import { fromDayKey } from "../finance/dates";
import { fractionalPart } from "../finance/corporate";
import type { ManualEntry, ManualProvento } from "../validation/schemas";

export async function createManualEntry(input: ManualEntry) {
  if (input.kind === "RENDA_VARIAVEL") {
    const asset = await prisma.asset.upsert({ where: { ticker: input.ticker }, update: {}, create: { ticker: input.ticker, assetClass: input.assetClass } });
    return prisma.transaction.create({
      data: { assetId: asset.id, type: input.type, tradeDate: fromDayKey(input.date), quantity: input.quantity, unitPrice: input.unitPrice, fees: input.fees, source: "MANUAL" },
    });
  }
  if (input.kind === "DESDOBRAMENTO") {
    const asset = await prisma.asset.findUnique({ where: { ticker: input.ticker } });
    if (!asset) throw new HttpError(404, `Ativo ${input.ticker} não encontrado. Lance uma compra antes.`);
    return prisma.transaction.create({
      data: { assetId: asset.id, type: input.type, tradeDate: fromDayKey(input.date), quantity: 0, unitPrice: 0, factor: input.factor, source: "MANUAL" },
    });
  }
  if (input.kind === "TROCA_TICKER") return createTickerSwap(input);
  if (input.kind === "BAIXA_FRACAO") return createFractionWriteoff(input);
  if (input.kind === "REDUCAO_CUSTO") return createCostReduction(input);
  // renda fixa: cada compra vira 1 unidade de valor = valor aplicado
  const name = input.name.trim();
  let asset = await prisma.asset.findUnique({ where: { ticker: name } });
  if (!asset) {
    asset = await prisma.asset.create({
      data: {
        ticker: name, name, assetClass: input.assetClass,
        fixedIncome: { create: { indexer: input.indexer, rate: input.rate, maturityDate: fromDayKey(input.maturityDate), issuer: input.issuer, isTaxExempt: input.isTaxExempt } },
      },
    });
  }
  if (input.type === "BUY") {
    return prisma.transaction.create({ data: { assetId: asset.id, type: "BUY", tradeDate: fromDayKey(input.date), quantity: 1, unitPrice: input.amount, source: "MANUAL" } });
  }
  const txs = await prisma.transaction.findMany({ where: { assetId: asset.id } });
  const open = txs.reduce((q, t) => (t.type === "BUY" ? q + t.quantity : ["SELL", "MATURITY", "AMORTIZATION"].includes(t.type) ? q - t.quantity : q), 0);
  if (open <= 1e-9) throw new HttpError(400, `Não há posição aberta em "${name}" para resgatar.`);
  const fi = await prisma.fixedIncomeTerms.findUnique({ where: { assetId: asset.id } });
  const atMaturity = fi ? fromDayKey(input.date) >= fi.maturityDate : false;
  return prisma.transaction.create({
    data: { assetId: asset.id, type: atMaturity ? "MATURITY" : "SELL", tradeDate: fromDayKey(input.date), quantity: open, unitPrice: input.amount / open, source: "MANUAL" },
  });
}

export async function createManualProvento(input: ManualProvento) {
  const asset = await prisma.asset.findUnique({ where: { ticker: input.ticker } });
  if (!asset) throw new HttpError(404, `Ativo ${input.ticker} não encontrado. Lance uma compra antes.`);
  return prisma.provento.create({
    data: {
      assetId: asset.id, type: input.type, paymentDate: fromDayKey(input.paymentDate),
      comDate: input.comDate ? fromDayKey(input.comDate) : null, quantity: input.quantity ?? null,
      grossAmount: input.grossAmount, taxWithheld: input.taxWithheld, netAmount: Math.round((input.grossAmount - input.taxWithheld) * 100) / 100, source: "MANUAL",
    },
  });
}

type Swap = Extract<ManualEntry, { kind: "TROCA_TICKER" }>;
type Fraction = Extract<ManualEntry, { kind: "BAIXA_FRACAO" }>;

/** Troca de ticker / incorporação / conversão de recibo: move posição e custo para o ticker de destino. */
async function createTickerSwap(input: Swap) {
  if (input.fromTicker === input.toTicker) throw new HttpError(400, "Origem e destino são o mesmo ticker.");
  const from = await prisma.asset.findUnique({ where: { ticker: input.fromTicker } });
  if (!from) throw new HttpError(404, `Ativo de origem ${input.fromTicker} não encontrado.`);
  const to = await prisma.asset.upsert({
    where: { ticker: input.toTicker }, update: { isActive: true },
    create: { ticker: input.toTicker, assetClass: from.assetClass },
  });
  // impede ciclo: seguindo as trocas a partir do destino não se pode voltar à origem
  let cursor: string | null = to.id;
  for (let hop = 0; cursor && hop < 25; hop++) {
    if (cursor === from.id) throw new HttpError(400, `Troca criaria um ciclo entre ${input.fromTicker} e ${input.toTicker}.`);
    const next: { counterpartAssetId: string | null } | null = await prisma.transaction.findFirst({
      where: { assetId: cursor, type: "TRANSFER_OUT" }, select: { counterpartAssetId: true },
    });
    cursor = next?.counterpartAssetId ?? null;
  }
  const tx = await prisma.transaction.create({
    data: {
      assetId: from.id, type: "TRANSFER_OUT", tradeDate: fromDayKey(input.date), quantity: input.quantity ?? 0,
      unitPrice: 0, factor: input.ratio, counterpartAssetId: to.id, source: "MANUAL",
    },
  });
  if (!input.quantity) await prisma.asset.update({ where: { id: from.id }, data: { isActive: false } }); // posição inteira: deixa de ser consultado nos syncs
  return tx;
}

/** Baixa de fração residual (leilão de frações). Sem quantidade, usa a parte fracionária da posição atual. */
async function createFractionWriteoff(input: Fraction) {
  const asset = await prisma.asset.findUnique({ where: { ticker: input.ticker } });
  if (!asset) throw new HttpError(404, `Ativo ${input.ticker} não encontrado.`);
  let qty = input.quantity;
  if (!qty) {
    const pos = await prisma.positionSnapshot.findFirst({ where: { assetId: asset.id }, orderBy: { date: "desc" } });
    qty = pos ? fractionalPart(pos.quantity) : 0;
    if (!qty) throw new HttpError(400, `${input.ticker} não tem fração residual. Informe a quantidade manualmente.`);
  }
  return prisma.transaction.create({
    data: { assetId: asset.id, type: "FRACTION_WRITEOFF", tradeDate: fromDayKey(input.date), quantity: qty, unitPrice: input.proceeds / qty, source: "MANUAL" },
  });
}

type CostReduction = Extract<ManualEntry, { kind: "REDUCAO_CUSTO" }>;

/** Redução de custo (resgate/amortização em incorporação): o valor entra no caixa e abate o custo; a quantidade não muda. */
async function createCostReduction(input: CostReduction) {
  const asset = await prisma.asset.findUnique({ where: { ticker: input.ticker } });
  if (!asset) throw new HttpError(404, `Ativo ${input.ticker} não encontrado.`);
  const qty = input.quantity ?? 1;
  return prisma.transaction.create({
    data: { assetId: asset.id, type: "COST_REDUCTION", tradeDate: fromDayKey(input.date), quantity: qty, unitPrice: input.amount / qty, source: "MANUAL" },
  });
}
