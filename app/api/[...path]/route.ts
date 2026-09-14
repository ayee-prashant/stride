import { getSessionIdentity, getInviteIdentity } from "@/lib/server/auth";
import { getRepository } from "@/lib/server/database";
import { applicationOrigin } from "@/lib/server/deployment-config";
import { hashPassword } from "better-auth/crypto";
import { Invitations } from "@/lib/server/invitations";
import { Attachments } from "@/lib/server/attachments";
import { createObjectStorage, storageConfigured } from "@/lib/server/s3-storage";
import { emailConfigured } from "@/lib/server/email";
import { handleApi } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
function handle(request: Request) {
  return handleApi(request, {
    identity: () => getSessionIdentity(request.headers),
    repository: getRepository,
    origin: () => applicationOrigin(process.env),
    attachments: () => new Attachments(getRepository(), createObjectStorage(process.env)),
    invitations: () => new Invitations(getRepository(), hashPassword),
    inviteIdentity: () => getInviteIdentity(request.headers),
    capabilities: () => ({ email: emailConfigured(process.env), attachments: storageConfigured(process.env) }),
  });
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
