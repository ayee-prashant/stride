export class RequestError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
/** Never automatically retry mutations: a lost response does not mean no write occurred. */
export async function api<T>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, 30_000);
  try {
    const response = await fetch(`/api/${path}`, {
      method: options.method ?? "GET", credentials: "same-origin", cache: "no-store", signal: controller.signal,
      ...(options.body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(options.body) }),
    });
    const data = await response.json();
    if (!response.ok) throw new RequestError(data.error?.message ?? "The request failed. Please try again.", response.status);
    return data as T;
  } catch (error) {
    if (error instanceof RequestError || options.signal?.aborted) throw error;
    throw new RequestError(options.body === undefined
      ? "Could not reach your workspace. Check your connection and try again."
      : "We could not confirm whether the change was saved. Your draft is preserved. Refresh and check before trying again.", 0);
  } finally {
    clearTimeout(timer); options.signal?.removeEventListener("abort", abort);
  }
}
export function workspacePath(path: string, workspaceId: string): string {
  return `${path}?${new URLSearchParams({ workspace_id: workspaceId })}`;
}
