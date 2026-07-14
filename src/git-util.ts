import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MAX_OUT = 200_000;

export function resolveWorkingRoot(
  ctx: { tenantId?: string },
  cwdArg?: unknown
): string {
  if (typeof cwdArg === "string" && cwdArg.trim()) {
    return path.resolve(cwdArg.trim());
  }
  const mode = (process.env.DEPLOYMENT_MODE ?? "local").toLowerCase();
  if ((mode === "hub" || mode === "client") && ctx.tenantId) {
    const data =
      process.env.PLATFORM_DATA_DIR?.trim() ||
      path.join(
        process.env.APPDATA || path.join(os.homedir(), ".local", "share"),
        "GodMode"
      );
    return path.join(data, "tenant-workspaces", ctx.tenantId);
  }
  return process.env.PLATFORM_REPO_ROOT?.trim() || process.cwd();
}

export function assertInsideRoot(root: string, target: string): string {
  const base = path.resolve(root);
  const abs = path.resolve(base, target);
  const rel = path.relative(base, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escapes coding root: ${target}`);
  }
  return abs;
}

function truncate(text: string): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= MAX_OUT) return text;
  return `${buf.subarray(0, MAX_OUT).toString("utf8")}\n…[truncated]`;
}

export async function runGit(
  cwd: string,
  args: string[],
  opts?: { timeoutMs?: number }
): Promise<{ code: number; stdout: string; stderr: string }> {
  if (!fs.existsSync(cwd)) {
    throw new Error(`Working directory not found: ${cwd}`);
  }
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      shell: process.platform === "win32",
      env: { ...process.env },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`git ${args[0]} timed out`));
    }, opts?.timeoutMs ?? 120_000);
    child.stdout?.on("data", (c: Buffer) => {
      stdout += c.toString();
    });
    child.stderr?.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code: code ?? 1,
        stdout: truncate(stdout),
        stderr: truncate(stderr),
      });
    });
  });
}

export function rejectDestructiveGitArgs(args: string[]): void {
  const joined = args.join(" ").toLowerCase();
  if (
    /\s--force\b/.test(` ${joined}`) ||
    /\s-f\b/.test(` ${joined}`) ||
    /force-with-lease/.test(joined) ||
    /reset\s+--hard/.test(joined) ||
    /clean\s+-fd/.test(joined)
  ) {
    throw new Error(
      "Destructive git flags (force push, hard reset, clean -fd) are blocked by godmode-plugin-git"
    );
  }
}
