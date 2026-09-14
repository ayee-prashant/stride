import type { Repository } from "./repository.ts";

/** Recheck the original browser session: a fresh OAuth sign-in cannot revive a run. */
export async function deliveryDatabaseClock(repo: Repository) {
  const row = await repo.statement("SELECT clock_timestamp() AS instant").first<{ instant: Date }>();
  if (!row || !(row.instant instanceof Date) || !Number.isFinite(row.instant.getTime())) throw new Error("Database clock unavailable");
  return row.instant;
}
export function deliverySessionCheck(repo: Repository) {
  return async (sessionId: string, operatorId: string) => !!await repo.statement(
    "SELECT id FROM auth_sessions WHERE id=? AND user_id=? AND expires_at>CURRENT_TIMESTAMP",
    sessionId, operatorId,
  ).first();
}
