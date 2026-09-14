"use client";
import { useEffect, useRef } from "react";
import { object, text } from "@/lib/domain";

type ToolRegistry = { registerTool(tool: { name: string; title: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute: (input: unknown) => Promise<unknown> }, options: { signal: AbortSignal }): void | Promise<void> };
/** Stages the visible composer only; it never claims to create a persisted task. */
export function useTaskCreationTool(stage: (title: string) => void, ready: boolean) {
  const action = useRef(stage);
  useEffect(() => { action.current = stage; }, [stage]);
  useEffect(() => {
    if (!ready) return;
    const context = (document as Document & { modelContext?: ToolRegistry }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const report = () => { console.warn("Task composer tool registration unavailable."); };
    try {
      void Promise.resolve(context.registerTool({
        name: "start_task_creation", title: "Prepare a new task",
        description: "Open My Work and fill its task title. This does not save a task; the user must select Create task.",
        inputSchema: { type: "object", properties: { title: { type: "string", minLength: 1, maxLength: 200 } }, required: ["title"], additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        async execute(input) {
          const value = object(input, ["title"]); const title = text(value.title, "Title", 200);
          action.current(title);
          // Give React the next paint before confirming the visible staged state.
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
          return { staged: true, saved: false, title };
        },
      }, { signal: lifecycle.signal })).catch(report);
    } catch { report(); }
    return () => lifecycle.abort();
  }, [ready]);
}
