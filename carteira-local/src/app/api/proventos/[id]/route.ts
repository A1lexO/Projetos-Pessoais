import { errorResponse } from "@/lib/api";
import { prisma } from "@/lib/db/prisma";
import { rebuildSnapshots } from "@/lib/services/snapshots";

export const runtime = "nodejs";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await prisma.provento.delete({ where: { id } });
    await rebuildSnapshots();
    return Response.json({ ok: true });
  } catch (e) { return errorResponse(e); }
}
