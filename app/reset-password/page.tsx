import { PasswordRecovery } from "@/components/stride/password-recovery";
export const dynamic = "force-dynamic";
export default async function ResetPassword({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const token = typeof params.token === "string" && params.token.length <= 512 ? params.token : "";
  return <PasswordRecovery enabled resetToken={token} />;
}
