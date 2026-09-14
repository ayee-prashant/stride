"use client";
import { useEffect, useState } from "react";
import { api, workspacePath } from "@/lib/client-api";
import type { Workload } from "@/lib/productivity";

export function WorkloadSummary({ workspaceId, revision }: { workspaceId: string; revision: number }) {
  const [result, setResult] = useState<{ rows?: Workload[]; error?: string }>({});
  useEffect(() => { const c = new AbortController(); api<Workload[]>(workspacePath("workload", workspaceId), { signal: c.signal }).then(rows => setResult({ rows })).catch(e => { if (!c.signal.aborted) setResult({ error: e.message }); }); return () => c.abort(); }, [workspaceId, revision]);
  return <section className="workload-summary"><h2>Team workload</h2><p className="muted text-sm">Open work across active projects.</p>{result.error ? <p role="alert">{result.error}</p> : result.rows ? <div className="workload-table"><table><thead><tr><th>Teammate</th><th>Open</th><th>Blocked</th><th>Overdue</th></tr></thead><tbody>{result.rows.map(row => <tr key={row.user_id}><th scope="row">{row.name}</th><td>{row.open}</td><td>{row.blocked}</td><td className={row.overdue ? "overdue" : ""}>{row.overdue}</td></tr>)}</tbody></table></div> : <p role="status">Loading workload…</p>}</section>;
}
