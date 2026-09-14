import { AppError, identifier } from "../domain.ts";
import type { Identity } from "../domain.ts";
import { downloadDisposition, MAX_FILE_BYTES } from "../files.ts";
import { assertSameOrigin } from "./http.ts";
import type { Attachments } from "./attachments.ts";

export async function readUpload(request: Request): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length")) > MAX_FILE_BYTES) throw new AppError(413, "FILE_TOO_LARGE", "Files must be no larger than 5 MB.");
  if (!request.body) throw new AppError(400, "FILE_REQUIRED", "Choose a file to upload.");
  const reader = request.body.getReader(); let total = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > MAX_FILE_BYTES) { await reader.cancel(); throw new AppError(413, "FILE_TOO_LARGE", "Files must be no larger than 5 MB."); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes;
}
export async function handleFile(request: Request, dependencies: { identity: () => Promise<Identity | null>; origin: string; attachments: () => Attachments }): Promise<Response> {
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Vary": "Cookie", "Referrer-Policy": "no-referrer" };
  try {
    const user = await dependencies.identity(); if (!user) throw new AppError(401, "SIGN_IN_REQUIRED", "Sign in to access attachments.");
    const url = new URL(request.url); const workspace = identifier(url.searchParams.get("workspace_id"));
    const attachments = dependencies.attachments();
    if (request.method === "GET") {
      const result = await attachments.download(user.userId, workspace, identifier(url.searchParams.get("id")));
      return new Response(result.stream, { headers: { ...headers, "Content-Type": "application/octet-stream", "Content-Disposition": downloadDisposition(result.metadata.filename), "Content-Security-Policy": "sandbox; default-src 'none'" } });
    }
    if (request.method !== "POST") throw new AppError(405, "METHOD_NOT_ALLOWED", "This operation is unavailable.");
    assertSameOrigin(request, dependencies.origin);
    if (request.headers.get("content-type") !== "application/octet-stream") throw new AppError(415, "BINARY_REQUIRED", "Upload the file as binary data.");
    const taskId = identifier(url.searchParams.get("task_id"));
    await attachments.repo.membership(user.userId, workspace);
    let filename: string;
    try { filename = decodeURIComponent(request.headers.get("x-file-name") ?? ""); } catch { throw new AppError(400, "INVALID_FILE", "Invalid filename."); }
    const commentId = url.searchParams.get("comment_id");
    const result = await attachments.upload(user.userId, workspace, taskId, commentId ? identifier(commentId) : null, filename, await readUpload(request));
    return Response.json(result, { status: 201, headers });
  } catch (error) {
    const known = error instanceof AppError;
    return Response.json({ error: { code: known ? error.code : "FILE_UNAVAILABLE", message: known ? error.message : "File storage is temporarily unavailable. Refresh and check the attachment list before retrying." } }, { status: known ? error.status : 503, headers });
  }
}
