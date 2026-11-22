import { HttpProviderError } from "../http.ts";
import { createBrapiProvider } from "./brapi.ts";
import { createThrottle } from "./throttle.ts";
import type { HistoryPoint, QuoteProvider, SecurityRef } from "./provider.ts";
import { createYahooProvider } from "./yahoo.ts";

/**
 * Tenta os provedores em ordem. Após `threshold` rate limits CONSECUTIVOS, o provedor é
 * "desligado" até o fim da execução (circuit breaker) para não martelar um IP já bloqueado.
 */
export class ProviderChain {
  providers: QuoteProvider[];
  threshold: number;
  tripped = new Set<string>();
  streak = new Map<string, number>();

  constructor(providers: QuoteProvider[], threshold = 3) {
    this.providers = providers;
    this.threshold = threshold;
  }

  private active() { return this.providers.filter((p) => p.isConfigured() && !this.tripped.has(p.name)); }
  isExhausted(): boolean { return this.active().length === 0; }

  async fetchHistory(ref: SecurityRef, from: string, to: string): Promise<{ provider: string; points: HistoryPoint[] }> {
    const errors: string[] = [];
    for (const p of this.providers) {
      if (!p.isConfigured()) continue;
      if (this.tripped.has(p.name)) { errors.push(`${p.name}: pausado por rate limit`); continue; }
      try {
        const points = await p.fetchHistory(ref, from, to);
        this.streak.set(p.name, 0);
        if (!points.length) { errors.push(`${p.name}: sem dados`); continue; }
        return { provider: p.name, points };
      } catch (e) {
        errors.push(`${p.name}: ${e instanceof Error ? e.message : String(e)}`);
        if (e instanceof HttpProviderError && e.kind === "rate_limit") {
          const n = (this.streak.get(p.name) ?? 0) + 1;
          this.streak.set(p.name, n);
          if (n >= this.threshold) this.tripped.add(p.name);
        } else {
          this.streak.set(p.name, 0);
        }
      }
    }
    throw new Error(errors.join(" | ") || "nenhum provedor configurado");
  }
}

/** Yahoo (principal) + BRAPI (se BRAPI_TOKEN estiver no .env). QUOTE_DELAY_MS controla o intervalo entre chamadas (padrão 450). */
export function createDefaultChain(env: Record<string, string | undefined> = process.env): ProviderChain {
  const delay = Number(env.QUOTE_DELAY_MS ?? 450);
  return new ProviderChain([
    createYahooProvider({ throttle: createThrottle(delay) }),
    createBrapiProvider({ token: env.BRAPI_TOKEN?.trim() || undefined, throttle: createThrottle(delay) }),
  ]);
}
