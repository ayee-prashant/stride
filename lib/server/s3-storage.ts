import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { AppError } from "../domain.ts";
import type { ObjectStorage } from "../files.ts";
export function storageConfigured(env: NodeJS.ProcessEnv): boolean {
  return [env.STRIDE_S3_ENDPOINT, env.STRIDE_S3_BUCKET, env.STRIDE_S3_ACCESS_KEY_ID, env.STRIDE_S3_SECRET_ACCESS_KEY].every(value => !!value?.trim());
}
export function createObjectStorage(env: NodeJS.ProcessEnv): ObjectStorage {
  if (!storageConfigured(env)) throw new AppError(503, "STORAGE_UNAVAILABLE", "File storage is not connected yet.");
  const endpoint = new URL(env.STRIDE_S3_ENDPOINT!);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error("File storage requires a trusted HTTPS endpoint");
  const bucket = env.STRIDE_S3_BUCKET!;
  const client = new S3Client({ endpoint: endpoint.href, region: env.STRIDE_S3_REGION || "auto", forcePathStyle: true, maxAttempts: 2,
    credentials: { accessKeyId: env.STRIDE_S3_ACCESS_KEY_ID!, secretAccessKey: env.STRIDE_S3_SECRET_ACCESS_KEY! },
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
  });
  return {
    async put(key, bytes, mediaType) { await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: mediaType, ContentLength: bytes.length }), { abortSignal: AbortSignal.timeout(30000) }); },
    async get(key) { const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(30000) }); if (!result.Body) throw new Error("File body is unavailable"); return result.Body.transformToWebStream(); },
    async remove(key) { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(30000) }); },
  };
}
