import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionIdentity } from "@/lib/server/auth";
import { AppError } from "@/lib/domain";
import { WorkspaceApp } from "@/components/stride/workspace-app";

export const dynamic = "force-dynamic";
export default async function Home() {
  let user;
  try { user = await getSessionIdentity(await headers()); }
  catch (error) { if (!(error instanceof AppError && error.code === "SETUP_REQUIRED")) throw error; }
  if (!user) redirect("/sign-in");
  return <WorkspaceApp identity={{ userId: user.userId, email: user.email, displayName: user.displayName }} />;
}
