import { ZodError } from "zod";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export function errorResponse(e: unknown): Response {
  if (e instanceof ZodError) {
    const msg = e.issues.map((i) => `${i.path.join(".") || "campo"}: ${i.message}`).join("; ");
    return Response.json({ error: msg }, { status: 400 });
  }
  if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json({ error: e instanceof Error ? e.message : "erro inesperado" }, { status: 500 });
}
