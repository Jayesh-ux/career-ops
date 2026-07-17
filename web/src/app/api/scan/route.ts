import { NextRequest } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * POST /api/scan — Run the real portal scanner (writes to pipeline.md).
 * This is the "apply" scan, not the dry-run discovery.
 * Body: { keywords?: string[], locations?: string[] }
 * Streams NDJSON progress events.
 */
export async function POST(req: NextRequest) {
  // Guard: check scanner exists
  if (!fs.existsSync(rootScript("scan-ats-full"))) {
    return Response.json(
      { error: "The discovery scanner isn't available in this checkout yet." },
      { status: 400 },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* empty body → defaults */
  }

  const keywords = ((body.keywords as string[]) || []).filter(Boolean);
  const locations = ((body.locations as string[]) || []).filter(Boolean);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          /* stream closed */
        }
      };

      send({ kind: "start", mode: "full", keywords, locations });

      const args = [
        rootScript("scan-ats-full"),
        "--since",
        "7",
      ];

      const child = spawn(process.execPath, args, {
        cwd: careerOpsRoot(),
        env: { ...process.env },
      });

      let outBuf = "";
      let errBuf = "";
      let totalFound = 0;

      child.stdout.on("data", (d: Buffer) => {
        outBuf += d.toString();
        const parts = outBuf.split(/\r\n|\r|\n/);
        outBuf = parts.pop() ?? "";
        for (const line of parts) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          // Count new offers (lines starting with +)
          if (/^\s*\+/.test(trimmed)) totalFound++;
          send({ kind: "log", line: trimmed });
        }
      });

      child.stderr.on("data", (d: Buffer) => {
        errBuf += d.toString();
        const parts = errBuf.split(/\r?\n/);
        errBuf = parts.pop() ?? "";
        for (const line of parts) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          send({ kind: "log", line: trimmed });
        }
      });

      child.on("error", (e) => {
        send({ kind: "error", message: e instanceof Error ? e.message : "scanner failed" });
        controller.close();
      });

      child.on("close", (code) => {
        // Flush remaining buffer
        if (outBuf.trim()) send({ kind: "log", line: outBuf.trim() });
        if (errBuf.trim()) send({ kind: "log", line: errBuf.trim() });

        send({
          kind: "done",
          exitCode: code,
          totalFound,
          message: code === 0
            ? `Scan complete. ${totalFound} new offers found.`
            : `Scan exited with code ${code}.`,
        });
        controller.close();
      });

      // Safety timeout
      setTimeout(() => {
        try {
          child.kill("SIGTERM");
        } catch {
          /* ignore */
        }
        send({ kind: "error", message: "Scan timed out after 4 minutes" });
        controller.close();
      }, 240_000);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
