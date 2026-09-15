/** A bounded read loop. Mutations must never use this scheduler. */
export function startVisibleRefresh(read: (signal: AbortSignal) => Promise<void>, canRead: () => boolean, interval = 30_000) {
  let stopped = false;
  let pending: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout>;
  let delay = interval;
  let lastStart = -Infinity;
  function schedule() { if (!stopped) timer = setTimeout(() => { void run(); }, delay); }
  async function run() {
    if (stopped || pending) return;
    clearTimeout(timer);
    if (!canRead() || Date.now() - lastStart < 5_000) { schedule(); return; }
    const controller = new AbortController(); pending = controller; lastStart = Date.now();
    try { await read(controller.signal); delay = interval; }
    catch { delay = Math.min(delay * 2, 120_000); }
    finally { pending = undefined; schedule(); }
  }
  schedule();
  return { trigger: () => { void run(); }, stop: () => { stopped = true; clearTimeout(timer); pending?.abort(); } };
}
