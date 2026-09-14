/** SQL fragments use only hard-coded column expressions supplied by repositories. */
export function notificationAllowed(workspace: string, task: string, recipient: string, kind: "assignment" | "mention" | "overdue" | "reminder"): string {
  const field = kind === "assignment" ? "assignments" : kind === "mention" ? "mentions" : "due_reminders";
  return `NOT EXISTS(SELECT 1 FROM notification_preferences np WHERE np.workspace_id=${workspace} AND np.user_id=${recipient} AND np.${field}=0)
    AND NOT EXISTS(SELECT 1 FROM task_notification_settings nm WHERE nm.workspace_id=${workspace} AND nm.task_id=${task} AND nm.user_id=${recipient} AND nm.muted=1)`;
}
