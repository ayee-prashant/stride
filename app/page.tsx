import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionIdentity } from "@/lib/server/auth";
import { AppError } from "@/lib/domain";
import { WorkspaceApp } from "@/components/stride/workspace-app";
import { taskLink } from "@/lib/productivity";

export const dynamic = "force-dynamic";
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const workspaceId = typeof params.workspace === "string" && params.workspace.length <= 256 ? params.workspace : "";
  const taskId = typeof params.task === "string" && params.task.length <= 256 ? params.task : "";
  let user;
  try { user = await getSessionIdentity(await headers()); }
  catch (error) { if (!(error instanceof AppError && error.code === "SETUP_REQUIRED")) throw error; }
  if (!user) redirect(`/sign-in?${new URLSearchParams({ next: workspaceId && taskId ? taskLink(workspaceId, taskId) : "/" })}`);
  return <WorkspaceApp identity={{ userId: user.userId, email: user.email, displayName: user.displayName }} initialLink={{ workspaceId, taskId }} />;
}
