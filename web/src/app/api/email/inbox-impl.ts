import { type EmailMessage } from "@/lib/email";

/**
 * Shared IMAP fetch implementation.
 * Extracted from inbox route for reuse by triage.
 */
export async function fetchEmails(
  email: string,
  password: string,
  opts: { daysBack?: number; maxEmails?: number; timeout?: number } = {},
): Promise<EmailMessage[]> {
  const { daysBack = 30, maxEmails = 50, timeout = 30000 } = opts;

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

    setTimeout(() => {
      finish();
    }, timeout);
  });
}
