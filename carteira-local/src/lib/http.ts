// Cliente HTTP resiliente: lê o corpo como TEXTO antes de interpretar JSON (provedores como o Yahoo
// devolvem "Too Many Requests" em texto puro), detecta rate limit, respeita Retry-After e faz
// retry com backoff exponencial + jitter apenas para erros transitórios.

export type ErrorKind = "rate_limit" | "http" | "parse" | "network";

export class HttpProviderError extends Error {
  kind: ErrorKind;
  status: number | null;
  retriable: boolean;
  retryAfterMs: number | null;
  constructor(message: string, kind: ErrorKind, status: number | null, retriable: boolean, retryAfterMs: number | null = null) {
    super(message);
    this.name = "HttpProviderError";
    this.kind = kind;
    this.status = status;
    this.retriable = retriable;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function parseRetryAfter(h: string | null): number | null {
  if (!h) return null;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const when = Date.parse(h);
  return Number.isNaN(when) ? null : Math.max(0, when - Date.now());
}

export async function fetchJson<T = unknown>(url: string, init: RequestInit = {}, opts: RetryOptions = {}): Promise<T> {
  const { retries = 3, baseDelayMs = 1500, maxDelayMs = 30_000, timeoutMs = 20_000, fetchFn = fetch, sleep = defaultSleep, random = Math.random } = opts;
  let last: HttpProviderError | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      let res: Response;
      try {
        res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      } catch (e) {
        throw new HttpProviderError(`falha de rede: ${e instanceof Error ? e.message : String(e)}`, "network", null, true);
      }
      const text = await res.text();
      if (res.status === 429 || /^\s*too many requests/i.test(text)) {
        throw new HttpProviderError("Too Many Requests (rate limit)", "rate_limit", 429, true, parseRetryAfter(res.headers.get("retry-after")));
      }
      if (res.status >= 500) throw new HttpProviderError(`HTTP ${res.status}`, "http", res.status, true);
      if (!res.ok) throw new HttpProviderError(`HTTP ${res.status}: ${text.slice(0, 120).replace(/\s+/g, " ")}`, "http", res.status, false);
      try { return JSON.parse(text) as T; }
      catch { throw new HttpProviderError(`resposta não é JSON: "${text.slice(0, 60).replace(/\s+/g, " ")}"`, "parse", res.status, false); }
    } catch (e) {
      last = e instanceof HttpProviderError ? e : new HttpProviderError(e instanceof Error ? e.message : String(e), "network", null, true);
      if (!last.retriable || attempt === retries) throw last;
      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt) * (0.75 + random() * 0.5);
      await sleep(Math.min(maxDelayMs, Math.max(last.retryAfterMs ?? 0, backoff)));
    }
  }
  throw last!;
}
