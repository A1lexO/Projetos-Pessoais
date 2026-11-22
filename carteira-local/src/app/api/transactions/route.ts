import { errorResponse } from "@/lib/api";
import { createManualEntry } from "@/lib/services/manual";
import { rebuildSnapshots } from "@/lib/services/snapshots";
import { manualEntrySchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    await createManualEntry(manualEntrySchema.parse(await req.json()));
    const r = await rebuildSnapshots();
    return Response.json({ ok: true, days: r.days, warnings: r.warnings });
  } catch (e) { return errorResponse(e); }
}
