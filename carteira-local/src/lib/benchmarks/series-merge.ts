export interface SeriesPoint { date: string; value: number }

/**
 * Plano para substituir um trecho de série no banco sem violar @@unique([benchmarkId, date]).
 * - Remove duplicatas de data na resposta da API (a última ocorrência vence).
 * - Série mensal (IPCA): a janela de exclusão começa no dia 1º do mês de `from`, porque o SGS
 *   devolve a observação do mês que contém `from` com data dia 01 (anterior a `from`).
 * - Em qualquer série: a exclusão nunca começa depois da primeira data devolvida pela API.
 */
export function planSeriesReplace(from: string, points: SeriesPoint[], monthly = false) {
  const byDate = new Map<string, number>();
  for (const p of points) byDate.set(p.date, p.value);
  const rows = [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, value]) => ({ date, value }));
  let deleteFrom = monthly ? `${from.slice(0, 7)}-01` : from;
  if (rows.length && rows[0].date < deleteFrom) deleteFrom = rows[0].date;
  return { deleteFrom, rows };
}
