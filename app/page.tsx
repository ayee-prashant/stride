import { requireChatGPTUser } from "./chatgpt-auth";
import { WorkspaceApp } from "@/components/stride/workspace-app";

export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await requireChatGPTUser("/");
  return <WorkspaceApp identity={{ userId: user.userId, email: user.email, displayName: user.displayName }} />;
}
