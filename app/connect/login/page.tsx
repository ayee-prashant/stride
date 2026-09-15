import { AgentOAuthLogin } from "@/components/stride/agent-oauth";
import { oauthQuery } from "@/lib/server/agent-consent";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) { return <AgentOAuthLogin query={oauthQuery(await searchParams)} />; }
