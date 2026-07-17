import { NextRequest } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { rootScript } from "@/lib/career-ops";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * POST /api/liveness — Check if job posting URLs are still active.
 * Body: { urls: string[] }
 * Returns per-URL results: active, expired, or uncertain.
 */
export async function POST(req: NextRequest) {
  const script = rootScript("check-liveness");
  if (!fs.existsSync(script)) {
    return Response.json(
      { error: "check-liveness.mjs not found in this checkout." },
      { status: 400 },
    );
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const urls = body.urls as string[];

    if (!Array.isArray(urls) || urls.length === 0) {
      return Response.json({ error: "urls array is required" }, { status: 400 });
    }

    if (urls.length > 20) {
      return Response.json(
        { error: "Maximum 20 URLs per request" },
        { status: 400 },
      );
    }

    const result = await new Promise<{
      stdout: string;
      stderr: string;
      exitCode: number;
    }>((resolve) => {
      const proc = spawn("node", [script, "--no-fallback", ...urls], {
        cwd: process.cwd(),
        env: { ...process.env, PATH: `/root/.opencode/bin:${process.env.PATH}` },
        timeout: 90000,
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (d: Buffer) => {
        stdout += d.toString();
      });
      proc.stderr.on("data", (d: Buffer) => {
        stderr += d.toString();
      });
      proc.on("close", (code) => {
        resolve({ stdout, stderr, exitCode: code ?? 1 });
      });
      proc.on("error", (e) => {
        resolve({
          stdout: "",
          stderr: e instanceof Error ? e.message : "spawn failed",
          exitCode: 1,
        });
      });
    });

    // Parse results from stdout
    const results = urls.map((url) => {
      const icon = { active: "✅", expired: "❌", uncertain: "⚠️" };
      let status: "active" | "expired" | "uncertain" = "uncertain";
      let reason = "";

      if (result.stdout.includes(`✅`) && result.stdout.includes(url)) {
        status = "active";
      } else if (result.stdout.includes(`❌`) && result.stdout.includes(url)) {
        status = "expired";
        // Extract reason (line after the URL)
        const lines = result.stdout.split("\n");
        const urlLine = lines.findIndex((l) => l.includes(url));
        if (urlLine >= 0 && lines[urlLine + 1]) {
          reason = lines[urlLine + 1].trim();
        }
      } else if (result.stdout.includes(`⚠️`) && result.stdout.includes(url)) {
        status = "uncertain";
      }

      return { url, status, reason };
    });

    // Extract summary line
    const summaryMatch = result.stdout.match(
      /Results:\s+(\d+)\s+active\s+(\d+)\s+expired\s+(\d+)\s+uncertain/,
    );

    return Response.json({
      results,
      summary: {
        active: summaryMatch ? parseInt(summaryMatch[1]) : results.filter((r) => r.status === "active").length,
        expired: summaryMatch ? parseInt(summaryMatch[2]) : results.filter((r) => r.status === "expired").length,
        uncertain: summaryMatch ? parseInt(summaryMatch[3]) : results.filter((r) => r.status === "uncertain").length,
        total: urls.length,
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "liveness check failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
