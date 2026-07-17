"use client";

import { useCallback, useEffect, useState } from "react";
import { Mail, Inbox, AlertTriangle, CheckCircle, XCircle, User, Trash2, Loader2, Send, Reply, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { CompanyLogo } from "@/components/company-logo";

type EmailMessage = {
  id: number;
  from: string;
  fromEmail: string;
  subject: string;
  date: string;
  preview: string;
  body: string;
  classification?: string;
};

type EmailSummary = {
  total: number;
  interview: number;
  offer: number;
  rejection: number;
  recruiter_reply: number;
  spam: number;
  noise: number;
};

const CLASSIFICATION_CONFIG: Record<string, { icon: typeof Mail; color: string; label: string }> = {
  interview: { icon: AlertTriangle, color: "text-amber-500", label: "Interview" },
  offer: { icon: CheckCircle, color: "text-emerald-500", label: "Offer" },
  rejection: { icon: XCircle, color: "text-red-500", label: "Rejected" },
  recruiter_reply: { icon: User, color: "text-blue-500", label: "Recruiter" },
  spam: { icon: Trash2, color: "text-gray-500", label: "Spam" },
  noise: { icon: Mail, color: "text-gray-400", label: "Noise" },
};

export function EmailTriage() {
  const [emails, setEmails] = useState<EmailMessage[]>([]);
  const [summary, setSummary] = useState<EmailSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [replyType, setReplyType] = useState<string>("interview");
  const [draftingId, setDraftingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [emailConfigured, setEmailConfigured] = useState<boolean | null>(null);

  // Check if email is configured on mount
  useEffect(() => {
    fetch("/api/email/status")
      .then((r) => r.json())
      .then((d) => setEmailConfigured(d.configured))
      .catch(() => setEmailConfigured(false));
  }, []);

  const fetchTriage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/email/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ daysBack: 14, maxEmails: 30 }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setEmails(data.emails || []);
        setSummary(data.summary || null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch emails");
    } finally {
      setLoading(false);
    }
  }, []);

  const draftReply = async (email: EmailMessage, type: string) => {
    setDraftingId(email.id);
    try {
      const res = await fetch("/api/email/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: email.subject,
          originalBody: email.body,
          replyType: type,
        }),
      });
      const data = await res.json();
      if (data.replyBody) {
        setDraft(data.replyBody);
      }
    } catch {
      setDraft("Failed to generate reply draft.");
    } finally {
      setDraftingId(null);
    }
  };

  const sendEmail = async (to: string, subject: string, body: string) => {
    setSending(true);
    try {
      const res = await fetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject, body }),
      });
      const data = await res.json();
      if (data.success) {
        setDraft(null);
        setExpandedId(null);
      }
    } catch {
      // ignore
    } finally {
      setSending(false);
    }
  };

  const filtered = filter ? emails.filter((e) => e.classification === filter) : emails;

  // Show setup prompt if email is not configured
  if (emailConfigured === false) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-foreground">Email Triage</h2>
          <p className="text-sm text-muted">Classify and respond to employer replies</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center dark:border-amber-800 dark:bg-amber-950">
          <Mail className="mx-auto mb-4 size-12 text-amber-500" />
          <h3 className="mb-2 text-lg font-semibold text-foreground">Email not configured</h3>
          <p className="mb-4 text-sm text-muted max-w-md mx-auto">
            Connect your Gmail to triage interview invites, track application replies, and get follow-up reminders.
          </p>
          <p className="text-xs text-muted">
            Set up via the Android app onboarding or add <code className="rounded bg-surface px-1.5 py-0.5">GMAIL_USER</code> and <code className="rounded bg-surface px-1.5 py-0.5">GMAIL_APP_PASSWORD</code> to <code className="rounded bg-surface px-1.5 py-0.5">.bridge.env</code>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Email Triage</h2>
          <p className="text-sm text-muted">Classify and respond to employer replies</p>
        </div>
        <button
          type="button"
          onClick={fetchTriage}
          disabled={loading}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg bg-surface-hover px-4 py-2 text-sm font-medium text-foreground transition hover:bg-brand-soft hover:text-brand",
            loading && "opacity-50 cursor-not-allowed",
          )}
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Inbox className="size-4" />}
          {loading ? "Fetching..." : "Fetch Inbox"}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {summary && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-7">
          {Object.entries(CLASSIFICATION_CONFIG).map(([key, config]) => {
            const count = summary[key as keyof EmailSummary] ?? 0;
            const Icon = config.icon;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(filter === key ? null : key)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg border p-3 transition",
                  filter === key
                    ? "border-brand bg-brand-soft"
                    : "border-border bg-surface/40 hover:border-brand/30",
                )}
              >
                <Icon className={cn("size-4", config.color)} />
                <span className="text-lg font-semibold tabular-nums text-foreground">{count}</span>
                <span className="text-[10px] uppercase tracking-wider text-muted">{config.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {filtered.length === 0 && !loading && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Mail className="mb-3 size-8 text-faint" />
          <p className="text-sm text-muted">
            {emails.length === 0 ? "Click Fetch Inbox to load recent emails" : "No emails match this filter"}
          </p>
        </div>
      )}

      <div className="space-y-2">
        {filtered.map((email) => {
          const config = email.classification ? CLASSIFICATION_CONFIG[email.classification] : CLASSIFICATION_CONFIG.noise;
          const Icon = config.icon;
          const isExpanded = expandedId === email.id;

          return (
            <div
              key={email.id}
              className="rounded-xl border border-border bg-surface/40 transition hover:border-brand/30"
            >
              <button
                type="button"
                onClick={() => setExpandedId(isExpanded ? null : email.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                <Icon className={cn("size-4 shrink-0", config.color)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{email.subject || "(no subject)"}</span>
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider", config.color, "bg-surface-hover")}>
                      {config.label}
                    </span>
                  </div>
                  <p className="truncate text-xs text-muted">
                    {email.from} · {new Date(email.date).toLocaleDateString()}
                  </p>
                </div>
                {isExpanded ? <ChevronUp className="size-4 shrink-0 text-faint" /> : <ChevronDown className="size-4 shrink-0 text-faint" />}
              </button>

              {isExpanded && (
                <div className="border-t border-border px-4 py-4">
                  <p className="mb-4 whitespace-pre-wrap text-sm text-foreground/80">{email.body}</p>

                  <div className="flex flex-wrap gap-2">
                    <select
                      value={replyType}
                      onChange={(e) => setReplyType(e.target.value)}
                      className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-foreground"
                    >
                      <option value="interview">Interview Reply</option>
                      <option value="follow_up">Follow-up</option>
                      <option value="accept_offer">Accept Offer</option>
                      <option value="negotiate">Negotiate</option>
                      <option value="generic">Generic Thank You</option>
                    </select>

                    <button
                      type="button"
                      onClick={() => draftReply(email, replyType)}
                      disabled={draftingId === email.id}
                      className="inline-flex items-center gap-1.5 rounded-md bg-surface-hover px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-brand-soft hover:text-brand"
                    >
                      {draftingId === email.id ? <Loader2 className="size-3 animate-spin" /> : <Reply className="size-3" />}
                      Draft Reply
                    </button>
                  </div>

                  {draft && (
                    <div className="mt-4 rounded-lg border border-border bg-surface p-4">
                      <p className="mb-3 whitespace-pre-wrap text-sm text-foreground">{draft}</p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => sendEmail(email.fromEmail, email.subject, draft)}
                          disabled={sending}
                          className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand/90"
                        >
                          {sending ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
                          Send
                        </button>
                        <button
                          type="button"
                          onClick={() => setDraft(null)}
                          className="rounded-md bg-surface-hover px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-surface"
                        >
                          Discard
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
