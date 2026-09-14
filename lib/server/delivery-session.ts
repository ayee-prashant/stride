import type { Repository } from "./repository.ts";

/** Recheck the original browser session: a fresh OAuth sign-in cannot revive a run. */
export function deliverySessionCheck(repo: Repository) {
  return async (sessionId: string, operatorId: string) => !!await repo.statement(
    "SELECT id FROM auth_sessions WHERE id=? AND user_id=? AND expires_at>CURRENT_TIMESTAMP",
    sessionId, operatorId,
  ).first();
}
