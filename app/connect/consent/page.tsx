import Link from "next/link";
import { headers } from "next/headers";
import { AgentOAuthConsent } from "@/components/stride/agent-oauth";
import { connectionConsent, oauthQuery } from "@/lib/server/agent-consent";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = oauthQuery(await searchParams);
  let c: Awaited<ReturnType<typeof connectionConsent>> | null = null;
  try { c = await connectionConsent(await headers(), query); } catch { /* Show a safe restart action. */ }
  if (c) return <AgentOAuthConsent query={query} profile={c.alias} connection={c.name} role={c.role_id.replaceAll("_", " ")} purpose={c.purpose} profileId={c.profile_id} />;
  return <main className="mx-auto max-w-lg space-y-4 p-8"><h1 className="text-2xl font-semibold">Connection unavailable</h1><p>Sign in as the profile’s operator and restart connection setup from your companion.</p><Link href="/" className="underline">Return to Stride</Link></main>;
}
