import { isEmailConfigured } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/email/status — Check if email credentials are configured.
 * Returns { configured: boolean, message: string }
 */
export async function GET() {
  const configured = isEmailConfigured();
  return Response.json({
    configured,
    message: configured
      ? "Email is configured via .bridge.env"
      : "Email not configured. Set up via Android onboarding or add GMAIL_USER/GMAIL_APP_PASSWORD to .bridge.env",
  });
}
