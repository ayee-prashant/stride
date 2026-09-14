import { PasswordRecovery } from "@/components/stride/password-recovery";
import { emailConfigured } from "@/lib/server/email";
export const dynamic = "force-dynamic";
export default function ForgotPassword() { return <PasswordRecovery enabled={emailConfigured(process.env)} />; }
