import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MAX_OUT = 200_000;
const MAX_ARGUMENT = 4_096;
const TENANT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE_REMOTE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/;

function badRequest(message: string): Error {
  return Object.assign(new Error(message), {
    status: 400,
    code: "GIT_INVALID_ARGUMENT",
    retryable: false,
  });
}

function text(value: unknown, name: string, required = false): string {
  if (value == null && !required) return "";
  if (typeof value !== "string") throw badRequest(`${name} must be a string`);
  const result = value.trim();
  if (required && !result) throw badRequest(`${name} is required`);
  if (result.length > MAX_ARGUMENT || /[\0\r\n]/.test(result)) {
    throw badRequest(`${name} is invalid`);
  }
  return result;
}

export function codingRoot(ctx: { tenantId?: string }): string {
  const mode = (process.env.DEPLOYMENT_MODE ?? "local").toLowerCase();
  if (mode === "hub" || mode === "client") {
    if (!ctx.tenantId) {
      throw Object.assign(new Error("Tenant coding root requires tenantId"), {
        status: 403,
        code: "GIT_TENANT_REQUIRED",
        retryable: false,
      });
    }
    if (
      !TENANT_ID.test(ctx.tenantId) ||
      ctx.tenantId === "." ||
      ctx.tenantId === ".."
    ) {
      throw badRequest("tenantId is invalid");
    }
    const data =
      process.env.PLATFORM_DATA_DIR?.trim() ||
      path.join(
        process.env.APPDATA || path.join(os.homedir(), ".local", "share"),
        "GodMode"
      );
    return path.join(data, "tenant-workspaces", ctx.tenantId);
  }
  return path.resolve(process.env.PLATFORM_REPO_ROOT?.trim() || process.cwd());
}

export function assertInsideRoot(root: string, target: string): string {
  const base = path.resolve(root);
  const abs = path.isAbsolute(target)
    ? path.resolve(target)
    : path.resolve(base, target);
  const rel = path.relative(base, abs);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw badRequest(`Path escapes coding root: ${target}`);
  }
  return abs;
}

export function resolveWorkingRoot(
  ctx: { tenantId?: string },
  cwdArg?: unknown
): string {
  const root = codingRoot(ctx);
  const requested = text(cwdArg, "cwd") || root;
  const contained = assertInsideRoot(root, requested);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw Object.assign(new Error(`Coding root not found: ${root}`), {
      status: 404,
      code: "GIT_CODING_ROOT_NOT_FOUND",
      retryable: false,
    });
  }
  if (!fs.existsSync(contained) || !fs.statSync(contained).isDirectory()) {
    throw Object.assign(new Error(`Working directory not found: ${contained}`), {
      status: 404,
      code: "GIT_WORKING_DIRECTORY_NOT_FOUND",
      retryable: false,
    });
  }
  const realRoot = fs.realpathSync.native(root);
  const realTarget = fs.realpathSync.native(contained);
  return assertInsideRoot(realRoot, realTarget);
}

export function parseBoolean(
  value: unknown,
  name: string,
  fallback: boolean
): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw badRequest(`${name} must be a boolean`);
  return value;
}

export function parseLimit(value: unknown, fallback = 15): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 50) {
    throw badRequest("limit must be an integer between 1 and 50");
  }
  return Number(value);
}

export function parseRemote(value: unknown): string {
  const remote = text(value, "remote") || "origin";
  if (remote.startsWith("-") || !SAFE_REMOTE.test(remote) || remote.includes("..")) {
    throw badRequest("remote is invalid");
  }
  return remote;
}

export function parseRevision(value: unknown, name: string): string {
  const revision = text(value, name, true);
  if (
    revision.startsWith("-") ||
    /[\s~^:?*[\\]/.test(revision) ||
    revision.includes("..") ||
    revision.includes("@{")
  ) {
    throw badRequest(`${name} is not a safe revision`);
  }
  return revision;
}

export function parseBranch(value: unknown): string {
  const branch = parseRevision(value, "name");
  if (
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.endsWith(".") ||
    branch.includes("//") ||
    branch.includes("/.")
  ) {
    throw badRequest("name is not a valid branch name");
  }
  return branch;
}

export function parsePath(value: unknown, name = "pathspec"): string {
  const result = text(value, name, true);
  if (result.length > 1_024) throw badRequest(`${name} is too long`);
  return result;
}

export function parsePaths(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 500) {
    throw badRequest("paths must contain between 1 and 500 pathspecs");
  }
  return value.map((item, index) => parsePath(item, `paths[${index}]`));
}

export function parseMessage(value: unknown): string {
  const message = text(value, "message", true);
  if (message.length > 10_000) throw badRequest("message is too long");
  return message;
}

function truncate(text: string): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= MAX_OUT) return text;
  return `${buf.subarray(0, MAX_OUT).toString("utf8")}\n…[truncated]`;
}

export async function runGit(
  cwd: string,
  args: string[],
  opts?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<{ code: number; stdout: string; stderr: string }> {
  if (!fs.existsSync(cwd)) {
    throw new Error(`Working directory not found: ${cwd}`);
  }
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      shell: false,
      env: { ...process.env },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts?.signal?.removeEventListener("abort", abort);
      reject(error);
    };
    const abort = () => {
      child.kill();
      finishError(
        Object.assign(new Error(`git ${args[0]} was cancelled`), {
          status: 499,
          code: "GIT_CANCELLED",
          retryable: false,
        })
      );
    };
    const timer = setTimeout(() => {
      child.kill();
      finishError(
        Object.assign(new Error(`git ${args[0]} timed out`), {
          status: 504,
          code: "GIT_TIMEOUT",
          retryable: true,
        })
      );
    }, opts?.timeoutMs ?? 120_000);
    opts?.signal?.addEventListener("abort", abort, { once: true });
    if (opts?.signal?.aborted) abort();
    child.stdout?.on("data", (c: Buffer) => {
      if (Buffer.byteLength(stdout) <= MAX_OUT) stdout += c.toString();
    });
    child.stderr?.on("data", (c: Buffer) => {
      if (Buffer.byteLength(stderr) <= MAX_OUT) stderr += c.toString();
    });
    child.on("error", finishError);
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts?.signal?.removeEventListener("abort", abort);
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
