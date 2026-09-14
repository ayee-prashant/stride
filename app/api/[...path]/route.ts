import { getSessionIdentity } from "@/lib/server/auth";
import { getRepository } from "@/lib/server/database";
import { applicationOrigin } from "@/lib/server/deployment-config";
import { handleApi } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
function handle(request: Request) {
  return handleApi(request, {
    identity: () => getSessionIdentity(request.headers),
    repository: getRepository,
    origin: () => applicationOrigin(process.env),
  });
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
