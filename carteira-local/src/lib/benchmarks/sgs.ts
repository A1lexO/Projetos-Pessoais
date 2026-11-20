import { prisma } from "../db/prisma";
import { addDays, fromDayKey, toDayKey } from "../finance/dates";

// API SGS do Banco Central. Séries diárias aceitam janelas de no máximo 10 anos por chamada.
export const SGS_BENCHMARKS = {
  CDI: { sgsCode: 12, name: "CDI (taxa diária, % a.d.)", valueKind: "DAILY_RATE" },
  SELIC: { sgsCode: 11, name: "Selic (taxa diária, % a.d.)", valueKind: "DAILY_RATE" },
  IPCA: { sgsCode: 433, name: "IPCA (variação mensal, %)", valueKind: "MONTHLY_RATE" },
} as const;
export type SgsKey = keyof typeof SGS_BENCHMARKS;

export const DEFAULT_HISTORY_START = "2018-01-01";
const CHUNK_YEARS = 9;

const fmtBR = (k: string) => `${k.slice(8, 10)}/${k.slice(5, 7)}/${k.slice(0, 4)}`;
const parseBR = (s: string) => `${s.slice(6, 10)}-${s.slice(3, 5)}-${s.slice(0, 2)}`;

async function getJson(url: string, retries = 2): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`SGS HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
}

export async function fetchSgsSeries(sgsCode: number, from: string, to: string): Promise<{ date: string; value: number }[]> {
  const out: { date: string; value: number }[] = [];
  let start = from;
  while (start <= to) {
    const y = Number(start.slice(0, 4)) + CHUNK_YEARS;
    const chunkEnd = `${y}${start.slice(4)}` < to ? addDays(`${y}${start.slice(4)}`, -1) : to;
    const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${sgsCode}/dados?formato=json&dataInicial=${fmtBR(start)}&dataFinal=${fmtBR(chunkEnd)}`;
    const rows = (await getJson(url)) as { data: string; valor: string }[];
    for (const r of rows) {
      const v = Number(r.valor);
      if (Number.isFinite(v)) out.push({ date: parseBR(r.data), value: v });
    }
    start = addDays(chunkEnd, 1);
  }
  return out;
}

async function ensureBenchmark(code: string, def: { sgsCode: number | null; name: string; valueKind: string }) {
  return prisma.benchmark.upsert({
    where: { code },
    update: { name: def.name, sgsCode: def.sgsCode, valueKind: def.valueKind },
    create: { code, name: def.name, sgsCode: def.sgsCode, valueKind: def.valueKind },
  });
}

/** Sincroniza uma série do SGS. Incremental por padrão (re-busca uma margem para pegar revisões). */
export async function syncSgsBenchmark(key: SgsKey, opts: { since?: string; full?: boolean } = {}) {
  const def = SGS_BENCHMARKS[key];
  const bench = await ensureBenchmark(key, def);
  let from = opts.since ?? DEFAULT_HISTORY_START;
  if (!opts.full && !opts.since) {
    const last = await prisma.benchmarkValue.findFirst({ where: { benchmarkId: bench.id }, orderBy: { date: "desc" } });
    if (last) from = addDays(toDayKey(last.date), key === "IPCA" ? -75 : -7);
  }
  const to = toDayKey(new Date());
  const points = await fetchSgsSeries(def.sgsCode, from, to);
  await prisma.$transaction([
    prisma.benchmarkValue.deleteMany({ where: { benchmarkId: bench.id, date: { gte: fromDayKey(from) } } }),
    prisma.benchmarkValue.createMany({ data: points.map((p) => ({ benchmarkId: bench.id, date: fromDayKey(p.date), value: p.value })) }),
    prisma.benchmark.update({ where: { id: bench.id }, data: { lastSyncAt: new Date() } }),
  ]);
  return { key, from, to, fetched: points.length };
}
