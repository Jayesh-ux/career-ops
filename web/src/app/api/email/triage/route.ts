import { NextRequest } from "next/server";
import { loadEmailConfig, classifyEmail, type EmailMessage, type EmailClassification } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/email/triage — Fetch and classify inbox emails.
 * Body: { daysBack?, maxEmails? }
 * Returns emails with classification labels (interview, offer, rejection, etc.).
 */
export async function POST(req: NextRequest) {
  const config = loadEmailConfig();
  if (!config) {
    return Response.json(
      { error: "Email credentials not configured. Set GMAIL_USER/GMAIL_APP_PASSWORD in .bridge.env or environment." },
      { status: 400 },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* empty body → defaults */
  }

  const daysBack = Math.min((body.daysBack as number) || 30, 90);
  const maxEmails = Math.min((body.maxEmails as number) || 50, 200);

  try {
    // Import the IMAP fetch function
    const { fetchEmails } = await import("@/app/api/email/inbox-impl");
    const allEmails = await fetchEmails(config.user, config.appPassword, {
      daysBack,
      maxEmails,
    });

    const triaged = allEmails.map((e: EmailMessage) => ({
      ...e,
      classification: classifyEmail(e),
    }));

    // Summary counts
    const summary = {
      total: triaged.length,
      interview: triaged.filter((e: { classification: EmailClassification }) => e.classification === "interview").length,
      offer: triaged.filter((e: { classification: EmailClassification }) => e.classification === "offer").length,
      rejection: triaged.filter((e: { classification: EmailClassification }) => e.classification === "rejection").length,
      recruiter_reply: triaged.filter((e: { classification: EmailClassification }) => e.classification === "recruiter_reply").length,
      spam: triaged.filter((e: { classification: EmailClassification }) => e.classification === "spam").length,
      noise: triaged.filter((e: { classification: EmailClassification }) => e.classification === "noise").length,
    };

    return Response.json({ emails: triaged, summary });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "triage failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
