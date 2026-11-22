import { errorResponse } from "@/lib/api";
import { createDefaultChain } from "@/lib/quotes/chain";
import { syncQuotes } from "@/lib/quotes/sync";
import { rebuildSnapshots } from "@/lib/services/snapshots";
import { syncAllBenchmarks } from "@/lib/services/sync-benchmarks";

export const runtime = "nodejs";
export const maxDuration = 300;

type Step = "benchmarks" | "quotes" | "snapshots";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { steps?: Step[]; full?: boolean };
    const steps: Step[] = body.steps?.length ? body.steps : ["benchmarks", "quotes", "snapshots"];
    const chain = createDefaultChain(); // compartilhada: rate limit visto no Ibovespa já protege as cotações
    const out: Record<string, unknown> = {};
    for (const step of steps) {
      try {
        if (step === "benchmarks") out.benchmarks = await syncAllBenchmarks({ full: body.full, chain });
        else if (step === "quotes") out.quotes = await syncQuotes({ full: body.full, chain });
        else { const r = await rebuildSnapshots(); out.snapshots = { days: r.days, warnings: r.warnings }; }
      } catch (e) {
        out[step] = { error: e instanceof Error ? e.message : String(e) };
      }
    }
    return Response.json(out);
  } catch (e) { return errorResponse(e); }
}
