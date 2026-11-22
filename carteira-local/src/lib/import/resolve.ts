import type { ParsedTransaction } from "./b3-parser.ts";

/**
 * Resgate de incorporação: escolhe, entre os candidatos, o ativo que já existe (no banco ou neste mesmo lote).
 * Sem nenhum candidato conhecido o resgate é descartado (com alerta) para não abater o custo do ativo errado.
 */
export function resolveCostTargets(txs: ParsedTransaction[], known: Set<string>): { txs: ParsedTransaction[]; alerts: string[]; dropped: number } {
  const out: ParsedTransaction[] = [];
  const alerts: string[] = [];
  let dropped = 0;
  for (const t of txs) {
    if (!t.costTargets) { out.push(t); continue; }
    const found = t.costTargets.filter((c) => known.has(c));
    if (!found.length) {
      dropped++;
      alerts.push(`Resgate de R$ ${(t.quantity * t.unitPrice).toFixed(2)} em ${t.date} não aplicado: nenhum destino (${t.costTargets.join(", ")}) está cadastrado. Lance em "Redução de custo".`);
      continue;
    }
    if (found.length > 1) alerts.push(`Resgate em ${t.date}: mais de um destino possível (${found.join(", ")}); aplicado em ${found[0]}. Confira.`);
    out.push({ ...t, ticker: found[0], costTargets: null });
  }
  return { txs: out, alerts, dropped };
}
