import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";

export type EmailConfig = {
  user: string;
  appPassword: string;
};

export type EmailMessage = {
  id: number;
  from: string;
  fromEmail: string;
  subject: string;
  date: string;
  preview: string;
  body: string;
  classification?: EmailClassification;
};

export type EmailClassification =
  | "interview"
  | "offer"
  | "rejection"
  | "recruiter_reply"
  | "spam"
  | "noise";

/**
 * Load Gmail credentials from .bridge.env or environment variables.
 * Priority: env vars > .bridge.env file.
 * The .bridge.env is the canonical source — written by the bridge server
 * during onboarding (POST /email/credentials).
 */
export function loadEmailConfig(): EmailConfig | null {
  const user = process.env.GMAIL_USER || "";
  const appPassword = process.env.GMAIL_APP_PASSWORD || "";

  if (user && appPassword) {
    return { user, appPassword };
  }

  // Try .bridge.env in career-ops root
  try {
    const envPath = path.join(careerOpsRoot(), ".bridge.env");
    const content = fs.readFileSync(envPath, "utf8");
    const env: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        env[key] = val;
      }
    }
    const u = env.GMAIL_USER || "";
    const p = env.GMAIL_APP_PASSWORD || "";
    if (u && p) return { user: u, appPassword: p };
  } catch {
    /* no .bridge.env */
  }

  return null;
}

/**
 * Check if email credentials are configured.
 * Returns true if both GMAIL_USER and GMAIL_APP_PASSWORD are available.
 */
export function isEmailConfigured(): boolean {
  return loadEmailConfig() !== null;
}

/**
 * Read profile data for reply drafting.
 */
export function readProfileForReply(): {
  name: string;
  phone: string;
  location: string;
  compensationTarget: string;
} {
  try {
    const yaml = require("js-yaml");
    const profilePath = path.join(careerOpsRoot(), "config", "profile.yml");
    const content = fs.readFileSync(profilePath, "utf8");
    const profile = yaml.load(content) as Record<string, unknown>;
    const candidate = (profile.candidate || {}) as Record<string, unknown>;
    const location = (profile.location || {}) as Record<string, unknown>;
    const compensation = (profile.compensation || {}) as Record<string, unknown>;
    return {
      name: (candidate.full_name as string) || "Candidate",
      phone: (candidate.phone as string) || "",
      location: (location.city as string) || "",
      compensationTarget: (compensation.target_range as string) || "5-6 LPA",
    };
  } catch {
    return { name: "Candidate", phone: "", location: "", compensationTarget: "5-6 LPA" };
  }
}

/**
 * Classify an email based on subject and body content.
 * Pure regex — no LLM, no external API.
 */
export function classifyEmail(email: EmailMessage): EmailClassification {
  const subj = (email.subject || "").toLowerCase();
  const body = (email.body || "").toLowerCase();

  const isInterview =
    /interview|schedule|meeting|phone screen|zoom|teams|on-site/i.test(subj) ||
    /schedule|availability|next step/i.test(body);

  const isRejection =
    /reject|unfortunately|not moving forward|decided to pursue other/i.test(subj) ||
    /unfortunately|not selected|other candidates/i.test(body);

  const isOffer =
    /offer|congratulations|pleased to inform|compensation|package/i.test(subj) ||
    /offer letter|join|start date/i.test(body);

  const isRecruiter =
    /recruiter|talent.?acquisition|hiring manager|your application/i.test(subj) ||
    /resume|application|profile|opportunity/i.test(body);

  const isSpam =
    /unsubscribe|promotion|newsletter|discount|you won|click here|limited time/i.test(
      subj,
    ) ||
    /marketing|sale|offer|subscribe/i.test(body);

  if (isInterview) return "interview";
  if (isOffer) return "offer";
  if (isRejection) return "rejection";
  if (isRecruiter) return "recruiter_reply";
  if (isSpam) return "spam";
  return "noise";
}

/**
 * Generate a reply draft based on type and profile data.
 * Template-based — no LLM, draft only (never sends).
 */
export function draftReply(
  type: string,
  subject: string,
  profile: ReturnType<typeof readProfileForReply>,
): { replyBody: string; subject: string } {
  const t = (type || "interview").toLowerCase();

  let replyBody = "";

  if (t === "interview") {
    replyBody = `Dear Hiring Team,

Thank you for your invitation. I would be delighted to attend an interview at your earliest convenience. I am available on weekdays, preferably in the afternoon (2 PM - 5 PM IST).

Please let me know if you need any additional information or documents from my side.

Looking forward to speaking with you.

Best regards,
${profile.name}
${profile.phone || ""}`.trim();
  } else if (t === "follow_up") {
    replyBody = `Dear Hiring Team,

I hope this message finds you well. I am writing to follow up on my application for the role. I remain very interested in the opportunity and would appreciate any update on the status of my application.

Thank you for your time and consideration.

Best regards,
${profile.name}
${profile.phone || ""}`.trim();
  } else if (t === "accept_offer") {
    replyBody = `Dear Hiring Team,

Thank you for the offer. I am thrilled to accept and look forward to joining the team. Please let me know the next steps regarding onboarding and any documents you need from my side.

Best regards,
${profile.name}
${profile.phone || ""}`.trim();
  } else if (t === "negotiate") {
    replyBody = `Dear Hiring Team,

Thank you for the offer. I am very excited about the role and the opportunity to contribute to your team. Before I accept, I was hoping we could discuss the compensation package. Based on my experience and the market rate for this role in ${profile.location || "Mumbai"}, I was expecting something in the range of ${profile.compensationTarget}. I am confident I can deliver strong value and would love to make this work.

I look forward to hearing your thoughts.

Best regards,
${profile.name}
${profile.phone || ""}`.trim();
  } else {
    replyBody = `Dear Team,

Thank you for your message.

Best regards,
${profile.name}`.trim();
  }

  return { replyBody, subject: `Re: ${subject || ""}` };
}
