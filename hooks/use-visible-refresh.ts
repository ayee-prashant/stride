"use client";
import { useEffect, useEffectEvent } from "react";
import { startVisibleRefresh } from "@/lib/visible-refresh";

/** Keeps the current request scoped to one view; hidden/offline tabs make no reads. */
export function useVisibleRefresh(key: string, enabled: boolean, read: (signal: AbortSignal) => Promise<void>, canRead: () => boolean = () => true) {
  const refresh = useEffectEvent(read);
  const allowed = useEffectEvent(() => !document.hidden && navigator.onLine && canRead());
  useEffect(() => {
    if (!enabled || !key) return;
    const loop = startVisibleRefresh(signal => refresh(signal), () => allowed());
    window.addEventListener("focus", loop.trigger);
    window.addEventListener("online", loop.trigger);
    document.addEventListener("visibilitychange", loop.trigger);
    return () => {
      loop.stop();
      window.removeEventListener("focus", loop.trigger);
      window.removeEventListener("online", loop.trigger);
      document.removeEventListener("visibilitychange", loop.trigger);
    };
  }, [key, enabled]);
}
