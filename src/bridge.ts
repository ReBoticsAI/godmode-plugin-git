import type { GodModePluginRegister } from "@godmode/plugin-api";
import {
  rejectDestructiveGitArgs,
  resolveWorkingRoot,
  runGit,
} from "./git-util.js";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === "string" && v.trim()) {
    return v.split(/\s+/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

export const register: GodModePluginRegister = (api) => {
  api.tools.register([
    {
      name: "git_status",
      description:
        "Show git branch and porcelain status for the coding root (working tree).",
      mode: "auto",
      parameters: {
        type: "object",
        properties: {
          cwd: {
            type: "string",
            description: "Optional absolute working directory override",
          },
        },
      },
      handler: async (args, ctx) => {
        const cwd = resolveWorkingRoot(ctx, args.cwd);
        const branch = await runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
        const status = await runGit(cwd, ["status", "--porcelain=v1", "-b"]);
        return {
          cwd,
          branch: branch.stdout.trim(),
          status: status.stdout,
          code: status.code,
          stderr: status.stderr || undefined,
        };
      },
    },
    {
      name: "git_diff",
      description:
        "Show git diff. Use staged=true for --cached; or commit range via base/head.",
      mode: "auto",
      parameters: {
        type: "object",
        properties: {
          cwd: { type: "string" },
          staged: { type: "boolean" },
          base: { type: "string", description: "Compare base (e.g. main)" },
          head: { type: "string", description: "Compare head (default HEAD)" },
          pathspec: { type: "string" },
        },
      },
      handler: async (args, ctx) => {
        const cwd = resolveWorkingRoot(ctx, args.cwd);
        const gitArgs = ["diff"];
        if (args.staged === true) gitArgs.push("--cached");
        if (str(args.base)) {
          gitArgs.push(`${str(args.base)}...${str(args.head) || "HEAD"}`);
        }
        if (str(args.pathspec)) gitArgs.push("--", str(args.pathspec));
        const r = await runGit(cwd, gitArgs);
        return { cwd, args: gitArgs, diff: r.stdout, code: r.code, stderr: r.stderr || undefined };
      },
    },
    {
      name: "git_log",
      description: "Recent git log (oneline).",
      mode: "auto",
      parameters: {
        type: "object",
        properties: {
          cwd: { type: "string" },
          limit: { type: "number", description: "Max commits (default 15)" },
        },
      },
      handler: async (args, ctx) => {
        const cwd = resolveWorkingRoot(ctx, args.cwd);
        const n = Math.min(50, Math.max(1, Number(args.limit ?? 15)));
        const r = await runGit(cwd, ["log", `-n${n}`, "--oneline", "--decorate"]);
        return { cwd, log: r.stdout, code: r.code, stderr: r.stderr || undefined };
      },
    },
    {
      name: "git_branches",
      description: "List local git branches (verbose).",
      mode: "auto",
      parameters: {
        type: "object",
        properties: {
          cwd: { type: "string" },
        },
      },
      handler: async (args, ctx) => {
        const cwd = resolveWorkingRoot(ctx, args.cwd);
        const r = await runGit(cwd, ["branch", "-vv"]);
        return { cwd, branches: r.stdout, code: r.code };
      },
    },
    {
      name: "git_checkout",
      description:
        "Create and/or checkout a branch. Use create=true with name to make a new branch.",
      mode: "confirm",
      parameters: {
        type: "object",
        properties: {
          cwd: { type: "string" },
          name: { type: "string", description: "Branch name" },
          create: {
            type: "boolean",
            description: "If true, git checkout -b (create)",
          },
        },
        required: ["name"],
      },
      handler: async (args, ctx) => {
        const cwd = resolveWorkingRoot(ctx, args.cwd);
        const name = str(args.name);
        if (!name) throw new Error("Branch name required");
        const gitArgs =
          args.create === true ? ["checkout", "-b", name] : ["checkout", name];
        const r = await runGit(cwd, gitArgs);
        if (r.code !== 0) throw new Error(r.stderr || r.stdout || "git checkout failed");
        return { cwd, checkedOut: name, created: args.create === true, ok: true };
      },
    },
    {
      name: "git_add",
      description: "Stage files (git add). Prefer pathspecs over bare '.' when possible.",
      mode: "confirm",
      parameters: {
        type: "object",
        properties: {
          cwd: { type: "string" },
          paths: {
            type: "array",
            items: { type: "string" },
            description: "Paths to stage",
          },
        },
        required: ["paths"],
      },
      handler: async (args, ctx) => {
        const cwd = resolveWorkingRoot(ctx, args.cwd);
        const paths = strList(args.paths);
        if (!paths.length) throw new Error("paths required");
        const r = await runGit(cwd, ["add", "--", ...paths]);
        if (r.code !== 0) throw new Error(r.stderr || "git add failed");
        return { cwd, staged: paths, ok: true };
      },
    },
    {
      name: "git_commit",
      description:
        "Commit staged changes. Does not amend; does not skip hooks unless skipHooks=true (confirm).",
      mode: "confirm",
      parameters: {
        type: "object",
        properties: {
          cwd: { type: "string" },
          message: { type: "string", description: "Commit message (required)" },
          skipHooks: {
            type: "boolean",
            description: "Pass --no-verify (discouraged)",
          },
        },
        required: ["message"],
      },
      handler: async (args, ctx) => {
        const cwd = resolveWorkingRoot(ctx, args.cwd);
        const message = str(args.message).trim();
        if (!message) throw new Error("message required");
        const gitArgs = ["commit", "-m", message];
        if (args.skipHooks === true) gitArgs.push("--no-verify");
        rejectDestructiveGitArgs(gitArgs);
        const r = await runGit(cwd, gitArgs);
        if (r.code !== 0) throw new Error(r.stderr || r.stdout || "git commit failed");
        const head = await runGit(cwd, ["rev-parse", "HEAD"]);
        return {
          cwd,
          ok: true,
          sha: head.stdout.trim(),
          stdout: r.stdout,
        };
      },
    },
    {
      name: "git_push",
      description:
        "Push current branch to remote (default origin, -u when needed). Force push is blocked.",
      mode: "confirm",
      parameters: {
        type: "object",
        properties: {
          cwd: { type: "string" },
          remote: { type: "string", description: "Default origin" },
          setUpstream: {
            type: "boolean",
            description: "Use -u (default true for new branches)",
          },
        },
      },
      handler: async (args, ctx) => {
        const cwd = resolveWorkingRoot(ctx, args.cwd);
        const remote = str(args.remote) || "origin";
        const branch = await runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
        const name = branch.stdout.trim();
        if (!name || name === "HEAD") throw new Error("Detached HEAD — checkout a branch first");
        const gitArgs = ["push"];
        if (args.setUpstream !== false) gitArgs.push("-u");
        gitArgs.push(remote, `HEAD:refs/heads/${name}`);
        rejectDestructiveGitArgs(gitArgs);
        const r = await runGit(cwd, gitArgs, { timeoutMs: 300_000 });
        if (r.code !== 0) throw new Error(r.stderr || r.stdout || "git push failed");
        return { cwd, ok: true, branch: name, remote, stdout: r.stdout, stderr: r.stderr };
      },
    },
    {
      name: "git_fetch",
      description: "Fetch from remote(s).",
      mode: "auto",
      parameters: {
        type: "object",
        properties: {
          cwd: { type: "string" },
          remote: { type: "string" },
        },
      },
      handler: async (args, ctx) => {
        const cwd = resolveWorkingRoot(ctx, args.cwd);
        const gitArgs = ["fetch"];
        if (str(args.remote)) gitArgs.push(str(args.remote));
        const r = await runGit(cwd, gitArgs, { timeoutMs: 300_000 });
        return { cwd, ok: r.code === 0, stdout: r.stdout, stderr: r.stderr, code: r.code };
      },
    },
    {
      name: "git_pull",
      description: "Pull with --ff-only by default (safe). Confirm required.",
      mode: "confirm",
      parameters: {
        type: "object",
        properties: {
          cwd: { type: "string" },
          remote: { type: "string" },
          ffOnly: { type: "boolean", description: "Default true" },
        },
      },
      handler: async (args, ctx) => {
        const cwd = resolveWorkingRoot(ctx, args.cwd);
        const gitArgs = ["pull"];
        if (args.ffOnly !== false) gitArgs.push("--ff-only");
        if (str(args.remote)) gitArgs.push(str(args.remote));
        rejectDestructiveGitArgs(gitArgs);
        const r = await runGit(cwd, gitArgs, { timeoutMs: 300_000 });
        if (r.code !== 0) throw new Error(r.stderr || r.stdout || "git pull failed");
        return { cwd, ok: true, stdout: r.stdout };
      },
    },
  ]);
};
