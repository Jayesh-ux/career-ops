import { NextRequest } from "next/server";
import { readProfileForReply, draftReply } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/email/reply — Draft a reply to an email.
 * Body: { subject, originalBody, replyType }
 * replyType: "interview" | "follow_up" | "accept_offer" | "negotiate" | "generic"
 * Returns draft only — never sends.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const { subject, originalBody, replyType } = body;

    if (!subject && !originalBody) {
      return Response.json(
        { error: "At least subject or originalBody is required" },
        { status: 400 },
      );
    }

    const profile = readProfileForReply();
    const draft = draftReply(
      (replyType as string) || "interview",
      (subject as string) || "",
      profile,
    );

    return Response.json({
      replyBody: draft.replyBody,
      subject: draft.subject,
      replyType: replyType || "interview",
      profile: {
        name: profile.name,
        phone: profile.phone,
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "reply draft failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
