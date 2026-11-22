import { defaultSleep } from "../http.ts";

/** Garante um intervalo mínimo entre chamadas (reserva o próximo "slot" antes de esperar). */
export function createThrottle(minIntervalMs: number, now: () => number = Date.now, sleep: (ms: number) => Promise<void> = defaultSleep) {
  let nextAllowed = 0;
  return async () => {
    const t = now();
    const wait = Math.max(0, nextAllowed - t);
    nextAllowed = Math.max(t, nextAllowed) + minIntervalMs;
    if (wait > 0) await sleep(wait);
  };
}
