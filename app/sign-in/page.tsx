import { SignIn } from "@/components/stride/sign-in";
import { authenticationSettings, postgresSettings } from "@/lib/server/deployment-config";

export const dynamic = "force-dynamic";
export default function SignInPage() {
  let available = false;
  try { authenticationSettings(process.env); postgresSettings(process.env); available = true; } catch { /* Fail closed until configured. */ }
  return <SignIn available={available} />;
}
