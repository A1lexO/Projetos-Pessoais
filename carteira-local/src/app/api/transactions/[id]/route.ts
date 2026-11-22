import { errorResponse, HttpError } from "@/lib/api";
import { fromDayKey } from "@/lib/finance/dates";
import { editTransactionSchema } from "@/lib/validation/schemas";
import { prisma } from "@/lib/db/prisma";
import { rebuildSnapshots } from "@/lib/services/snapshots";

export const runtime = "nodejs";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await prisma.transaction.delete({ where: { id } });
    await rebuildSnapshots();
    return Response.json({ ok: true });
  } catch (e) { return errorResponse(e); }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = editTransactionSchema.parse(await req.json());
    const data: Record<string, unknown> = {};
    if (body.date) data.tradeDate = fromDayKey(body.date);
    for (const k of ["quantity", "unitPrice", "fees", "factor"] as const) if (body[k] !== undefined) data[k] = body[k];
    if (!Object.keys(data).length) throw new HttpError(400, "Nenhum campo para alterar.");
    await prisma.transaction.update({ where: { id }, data });
    const r = await rebuildSnapshots();
    return Response.json({ ok: true, days: r.days, warnings: r.warnings });
  } catch (e) { return errorResponse(e); }
}
