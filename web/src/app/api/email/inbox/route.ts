import { NextRequest } from "next/server";
import { loadEmailConfig, type EmailMessage } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/email/inbox — Fetch recent emails via IMAP.
 * Query params: ?daysBack=30&maxEmails=50
 * Credentials from .bridge.env or env vars.
 */
export async function GET(req: NextRequest) {
  const config = loadEmailConfig();
  if (!config) {
    return Response.json(
      { error: "Email credentials not configured. Set GMAIL_USER/GMAIL_APP_PASSWORD in .bridge.env or environment." },
      { status: 400 },
    );
  }

  const url = new URL(req.url);
  const daysBack = parseInt(url.searchParams.get("daysBack") || "30", 10);
  const maxEmails = parseInt(url.searchParams.get("maxEmails") || "50", 10);

  try {
    const emails = await fetchEmails(config.user, config.appPassword, {
      daysBack: Math.min(daysBack, 90),
      maxEmails: Math.min(maxEmails, 200),
    });
    return Response.json({ emails });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "inbox fetch failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * Shared IMAP fetch — same logic as bridge-server.mjs fetchEmails().
 * Uses node-imap + mailparser for Gmail IMAP.
 */
async function fetchEmails(
  email: string,
  password: string,
  opts: { daysBack?: number; maxEmails?: number; timeout?: number } = {},
): Promise<EmailMessage[]> {
  const { daysBack = 30, maxEmails = 50, timeout = 30000 } = opts;

  // Dynamic imports (server-only)
  const Imap = (await import("imap")).default;
  const { simpleParser } = await import("mailparser");

  return new Promise((resolve) => {
    const emails: EmailMessage[] = [];
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      emails.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      emails.forEach((e, i) => {
        e.id = i + 1;
      });
      resolve(emails);
    };

    const imap = new Imap({
      user: email,
      password,
      host: "imap.gmail.com",
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
    });

    imap.once("ready", () => {
      imap.openBox("INBOX", true, (err: Error | null) => {
        if (err) {
          imap.end();
          finish();
          return;
        }
        const since = new Date(Date.now() - daysBack * 86400000)
          .toISOString()
          .split("T")[0];
        imap.search(["ALL", ["SINCE", since]], (err: Error | null, results: number[]) => {
          if (err || !results || results.length === 0) {
            imap.end();
            finish();
            return;
          }
          const latest = results.slice(-maxEmails);
          let pending = latest.length;
          let timedOut = false;

          if (pending === 0) {
            imap.end();
            finish();
            return;
          }

          const f = imap.fetch(latest, { bodies: "" });
          f.on("message", (msg: NodeJS.EventEmitter) => {
            let buf = "";
            msg.on("body", (stream: NodeJS.ReadableStream) => {
              stream.on("data", (chunk: Buffer) => {
                buf += chunk.toString("utf-8");
              });
              stream.on("end", () => {
                simpleParser(buf)
                  .then((parsed: { from?: { text: string; value: Array<{ address: string }> }; subject?: string; date?: Date; text?: string }) => {
                    emails.push({
                      id: 0,
                      from: parsed.from?.text || "",
                      fromEmail: parsed.from?.value?.[0]?.address || "",
                      subject: parsed.subject || "",
                      date: parsed.date
                        ? new Date(parsed.date).toISOString()
                        : new Date(0).toISOString(),
                      preview: (parsed.text || "").substring(0, 200),
                      body: (parsed.text || "").substring(0, 5000),
                    });
                  })
                  .catch(() => {
                    /* parse error — skip */
                  })
                  .finally(() => {
                    pending--;
                    if (pending <= 0 && !timedOut) {
                      timedOut = true;
                      imap.end();
                      finish();
                    }
                  });
              });
            });
            msg.on("end", () => {
              setTimeout(() => {
                if (pending <= 0 && !timedOut) {
                  timedOut = true;
                  imap.end();
                  finish();
                }
              }, 2000);
            });
          });
          f.once("error", () => {
            if (!timedOut) {
              timedOut = true;
              imap.end();
              finish();
            }
          });
          f.once("end", () => {
            setTimeout(() => {
              if (!timedOut) {
                timedOut = true;
                imap.end();
                finish();
              }
            }, 5000);
          });
        });
      });
    });

    imap.once("error", () => {
      finish();
    });

    imap.connect();

    // Safety timeout
    setTimeout(() => {
      finish();
    }, timeout);
  });
}
