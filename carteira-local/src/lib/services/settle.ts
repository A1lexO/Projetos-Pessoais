import { defaultSleep } from "../http.ts";

export type StepResult<T> = { key: string; ok: true; value: T } | { key: string; ok: false; error: string };

/** Executa etapas em sequência; a falha de uma NÃO interrompe as seguintes. */
export async function runIsolated<T>(steps: { key: string; run: () => Promise<T> }[], delayMs = 0): Promise<StepResult<T>[]> {
  const out: StepResult<T>[] = [];
  for (const s of steps) {
    try { out.push({ key: s.key, ok: true, value: await s.run() }); }
    catch (e) { out.push({ key: s.key, ok: false, error: e instanceof Error ? e.message : String(e) }); }
    if (delayMs) await defaultSleep(delayMs);
  }
  return out;
}
