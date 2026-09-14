import { AppError, text } from "./domain.ts";
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_TASK_FILES = 20;
export const MAX_WORKSPACE_BYTES = 200 * 1024 * 1024;
export interface ObjectStorage {
  put(key: string, bytes: Uint8Array, mediaType: string): Promise<void>;
  get(key: string): Promise<ReadableStream<Uint8Array>>;
  remove(key: string): Promise<void>;
}
export function verifyFile(filename: unknown, bytes: Uint8Array): { filename: string; mediaType: string } {
  const name = text(filename, "Filename", 160);
  if (/[\\/\r\n\u0000-\u001f]/.test(name) || name === "." || name === "..") throw new AppError(400, "INVALID_FILE", "Choose a filename without path separators or control characters.");
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw new AppError(413, "FILE_TOO_LARGE", "Files must be between 1 byte and 5 MB.");
  const extension = name.toLowerCase().split(".").at(-1);
  const prefix = Buffer.from(bytes.subarray(0, 16)); let mediaType = "";
  if (extension === "png" && prefix.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) mediaType = "image/png";
  if (["jpg", "jpeg"].includes(extension ?? "") && prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255) mediaType = "image/jpeg";
  if (extension === "webp" && prefix.subarray(0, 4).toString() === "RIFF" && prefix.subarray(8, 12).toString() === "WEBP") mediaType = "image/webp";
  if (extension === "pdf" && prefix.subarray(0, 5).toString() === "%PDF-") mediaType = "application/pdf";
  if (extension === "txt" || extension === "csv") {
    try { const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); if (!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(content)) mediaType = extension === "csv" ? "text/csv" : "text/plain"; } catch { /* Reject invalid UTF-8. */ }
  }
  if (!mediaType) throw new AppError(415, "FILE_TYPE_REJECTED", "Use a valid PNG, JPEG, WebP, PDF, TXT, or CSV file. Other file types are not supported.");
  return { filename: name, mediaType };
}
export function downloadDisposition(filename: string): string {
  return `attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}
