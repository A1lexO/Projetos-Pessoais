import { syncSgsBenchmark } from "../benchmarks/sgs";
import type { ProviderChain } from "../quotes/chain";
import { syncIbovespa } from "../quotes/sync";
import { runIsolated } from "./settle";

export interface BenchmarkSyncItem { key: string; ok: boolean; fetched?: number; provider?: string; note?: string; error?: string }

/**
 * CDI, Selic e IPCA (SGS) e Ibovespa (Yahoo/BRAPI), cada um ISOLADO: se o Ibovespa falhar
 * (ex.: rate limit), as séries do Banco Central continuam sendo salvas normalmente.
 */
export async function syncAllBenchmarks(opts: { full?: boolean; chain?: ProviderChain } = {}): Promise<BenchmarkSyncItem[]> {
  const results = await runIsolated<BenchmarkSyncItem>([
    ...(["CDI", "SELIC", "IPCA"] as const).map((key) => ({
      key,
      run: async (): Promise<BenchmarkSyncItem> => ({ key, ok: true, fetched: (await syncSgsBenchmark(key, { full: opts.full })).fetched }),
    })),
    {
      key: "IBOV",
      run: async (): Promise<BenchmarkSyncItem> => {
        const r = await syncIbovespa({ full: opts.full, chain: opts.chain });
        return { key: "IBOV", ok: true, fetched: r.fetched, provider: r.provider, note: r.fresh ? "já atualizado" : undefined };
      },
    },
  ], 250);
  return results.map((r) => (r.ok ? r.value : { key: r.key, ok: false, error: r.error }));
}
