import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { AppError } from "@/lib/domain";
import { handleApi } from "@/lib/server/http";
import { Repository } from "@/lib/server/repository";
import type { Database } from "@/lib/server/repository";

export const dynamic = "force-dynamic";
function handle(request: Request) {
  return handleApi(request, {
    identity: getChatGPTUser,
    repository: () => {
      if (!env.DB) throw new AppError(503, "STORAGE_UNAVAILABLE", "Workspace storage is not available yet. Please try again later.");
      return new Repository(env.DB as unknown as Database);
    },
  });
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
