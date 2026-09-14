import { SignIn } from "@/components/stride/sign-in";
import { authenticationSettings, postgresSettings } from "@/lib/server/deployment-config";
import { safeReturnTo } from "@/lib/productivity";

export const dynamic = "force-dynamic";
export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  let available = false;
  try { authenticationSettings(process.env); postgresSettings(process.env); available = true; } catch { /* Fail closed until configured. */ }
  return <SignIn available={available} next={safeReturnTo(params.next)} />;
}
