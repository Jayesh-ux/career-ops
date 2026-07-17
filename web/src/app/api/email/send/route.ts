import { NextRequest } from "next/server";
import fs from "node:fs";
import { loadEmailConfig } from "@/lib/email";
import { careerOpsRoot } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/email/send — Send an email via Gmail SMTP.
 * Body: { to, subject, body, company?, role?, pdfPath? }
 * Credentials are loaded from .bridge.env or env vars (never from the client).
 */
export async function POST(req: NextRequest) {
  const config = loadEmailConfig();
  if (!config) {
    return Response.json(
      { error: "Email credentials not configured. Set GMAIL_USER/GMAIL_APP_PASSWORD in .bridge.env or environment." },
      { status: 400 },
    );
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const { to, subject, body: emailBody, company, role, pdfPath } = body;

    if (!emailBody) {
      return Response.json({ error: "body is required" }, { status: 400 });
    }

    // Dynamic import nodemailer (server-only)
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.default.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      auth: { user: config.user, pass: config.appPassword },
    });

    const mailOpts = {
      from: config.user,
      to: (to as string) || config.user,
      subject: (subject as string) || `Application for ${role || ""} at ${company || ""}`.trim() || "Job Application",
      text: emailBody as string,
      attachments: [] as Array<{ filename: string; path: string }>,
    };

    // Attach PDF if provided and exists
    if (pdfPath && typeof pdfPath === "string") {
      const fullPath = pdfPath.startsWith("/")
        ? pdfPath
        : `${careerOpsRoot()}/${pdfPath}`;
      if (fs.existsSync(fullPath)) {
        mailOpts.attachments.push({ filename: "cv.pdf", path: fullPath });
      }
    }

    // Remove empty attachments array
    if (mailOpts.attachments.length === 0) {
      delete (mailOpts as { attachments?: unknown }).attachments;
    }

    const info = await transporter.sendMail(mailOpts);
    return Response.json({ success: true, messageId: info.messageId });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "send failed";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
