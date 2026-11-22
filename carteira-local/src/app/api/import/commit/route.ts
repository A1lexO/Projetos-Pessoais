import { errorResponse, HttpError } from "@/lib/api";
import { commitImport } from "@/lib/import/importer";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const file = (await req.formData()).get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Envie um arquivo no campo 'file'.");
    return Response.json(await commitImport(Buffer.from(await file.arrayBuffer()), file.name));
  } catch (e) { return errorResponse(e); }
}
