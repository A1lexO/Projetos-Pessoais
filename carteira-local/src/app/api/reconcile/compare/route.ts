import { errorResponse, HttpError } from "@/lib/api";
import { compareCustody, parseCustodyText } from "@/lib/reconcile/custody";
import { getSystemPositions } from "@/lib/services/queries";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { text } = (await req.json()) as { text?: string };
    const { lines, errors } = parseCustodyText(text ?? "");
    if (!lines.length) throw new HttpError(400, "Cole linhas no formato TICKER QUANTIDADE (uma por ativo).");
    return Response.json({ rows: compareCustody(await getSystemPositions(), lines), errors });
  } catch (e) { return errorResponse(e); }
}
