import { headers } from "next/headers";
import { getInviteIdentity } from "@/lib/server/auth";
import { JoinWorkspace } from "@/components/stride/join-workspace";
export const dynamic = "force-dynamic";
export default async function JoinPage() {
  const user = await getInviteIdentity(await headers());
  return <JoinWorkspace signedInEmail={user?.email ?? null} />;
}
