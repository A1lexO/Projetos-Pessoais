import { errorResponse } from "@/lib/api";
import { createManualProvento } from "@/lib/services/manual";
import { rebuildSnapshots } from "@/lib/services/snapshots";
import { manualProventoSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    await createManualProvento(manualProventoSchema.parse(await req.json()));
    const r = await rebuildSnapshots();
    return Response.json({ ok: true, days: r.days });
  } catch (e) { return errorResponse(e); }
}
