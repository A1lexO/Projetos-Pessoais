import { errorResponse } from "@/lib/api";
import { undoBatch } from "@/lib/import/importer";

export const runtime = "nodejs";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const r = await undoBatch(id);
    return Response.json({ ok: true, days: r.days });
  } catch (e) { return errorResponse(e); }
}
