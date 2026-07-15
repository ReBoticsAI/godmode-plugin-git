import type {
  PluginRecordAdapter,
  PluginRecordContext,
} from "@godmode/plugin-api";
import type { ActionDef, ObjectTypeDef, RecordData, RecordRow } from "@godmode/kernel";
import {
  codingRoot,
  parseBoolean,
  parseBranch,
  parseMessage,
  parsePaths,
  parseRemote,
  rejectDestructiveGitArgs,
  resolveWorkingRoot,
  runGit,
} from "./git-util.js";

export const GIT_REPOSITORY_TYPE = "GitRepository";
export const GIT_REPOSITORY_ID = "coding-root";

const cwdProperty = {
  cwd: {
    type: "string",
    minLength: 1,
    maxLength: 4_096,
    description: "Directory within the tenant coding root",
  },
};

const outputSchema = {
  type: "object",
  required: ["ok", "cwd"],
  properties: {
    ok: { type: "boolean" },
    cwd: { type: "string" },
    code: { type: "integer" },
    stdout: { type: "string" },
    stderr: { type: "string" },
    branch: { type: "string" },
    remote: { type: "string" },
    sha: { type: "string" },
    created: { type: "boolean" },
    staged: { type: "array", items: { type: "string" } },
  },
  additionalProperties: false,
};

const errorSchema = {
  type: "object",
  required: ["code", "message", "retryable"],
  properties: {
    code: { type: "string" },
    message: { type: "string" },
    retryable: { type: "boolean" },
    details: {},
  },
  additionalProperties: false,
};

type GitActionName = "branch" | "add" | "commit" | "push" | "fetch" | "pull";

function action(
  name: GitActionName,
  metadata: {
    label: string;
    description: string;
    effect: "write" | "external";
    timeoutMs: number;
    properties: Record<string, unknown>;
    required?: string[];
  }
): ActionDef {
  return {
    name,
    label: metadata.label,
    description: metadata.description,
    target: "record",
    effect: metadata.effect,
    execution: "sync",
    contractVersion: 1,
    roles: ["editor", "owner", "intelligence"],
    confirmation: { required: true, ttlSeconds: 300 },
    inputSchema: {
      type: "object",
      properties: { ...cwdProperty, ...metadata.properties },
      required: metadata.required,
      additionalProperties: false,
    },
    outputSchema,
    errorSchema,
    idempotency: { required: false, ttlSeconds: 300 },
    retry: { maxAttempts: 1, retryableErrorCodes: ["GIT_TIMEOUT"] },
    timeoutMs: metadata.timeoutMs,
    events: [{ type: `git.repository.${name}` }],
  };
}

export const GIT_REPOSITORY_ACTIONS: ActionDef[] = [
  action("branch", {
    label: "Change branch",
    description: "Create and/or check out a validated local branch.",
    effect: "write",
    timeoutMs: 120_000,
    properties: {
      name: { type: "string", minLength: 1, maxLength: 255 },
      create: { type: "boolean", default: false },
    },
    required: ["name"],
  }),
  action("add", {
    label: "Stage paths",
    description: "Stage bounded pathspecs after an explicit option terminator.",
    effect: "write",
    timeoutMs: 120_000,
    properties: {
      paths: {
        type: "array",
        minItems: 1,
        maxItems: 500,
        items: { type: "string", minLength: 1, maxLength: 1_024 },
      },
    },
    required: ["paths"],
  }),
  action("commit", {
    label: "Commit staged changes",
    description: "Create a commit from staged changes; hooks run unless explicitly disabled.",
    effect: "write",
    timeoutMs: 180_000,
    properties: {
      message: { type: "string", minLength: 1, maxLength: 10_000 },
      skipHooks: { type: "boolean", default: false },
    },
    required: ["message"],
  }),
  action("push", {
    label: "Push branch",
    description: "Push the current branch without force flags.",
    effect: "external",
    timeoutMs: 300_000,
    properties: {
      remote: { type: "string", minLength: 1, maxLength: 256, default: "origin" },
      setUpstream: { type: "boolean", default: true },
    },
  }),
  action("fetch", {
    label: "Fetch remote",
    description: "Fetch remote refs. This external network mutation requires confirmation.",
    effect: "external",
    timeoutMs: 300_000,
    properties: {
      remote: { type: "string", minLength: 1, maxLength: 256 },
    },
  }),
  action("pull", {
    label: "Pull branch",
    description: "Pull remote changes with fast-forward-only behavior by default.",
    effect: "external",
    timeoutMs: 300_000,
    properties: {
      remote: { type: "string", minLength: 1, maxLength: 256 },
      ffOnly: { type: "boolean", default: true },
    },
  }),
];

export const GIT_REPOSITORY_DEFINITION: ObjectTypeDef = {
  name: GIT_REPOSITORY_TYPE,
  label: "Git repository",
  labelPlural: "Git repositories",
  description: "The single Git checkout contained by the active tenant coding root.",
  storage: { kind: "adapter", adapterId: "git_repository" },
  database: "tenant",
  accessPolicy: "tenant-local",
  contractVersion: 1,
  fields: [
    { name: "id", label: "ID", fieldType: "Data", inForm: false },
    { name: "cwd", label: "Coding root", fieldType: "Data", inForm: false },
    { name: "tenant_id", label: "Tenant", fieldType: "Data", inForm: false },
  ],
  permissions: [
    { role: "viewer", read: true },
    { role: "editor", read: true },
    { role: "owner", read: true },
    { role: "intelligence", read: true },
  ],
  operations: ["list", "get"],
  actions: GIT_REPOSITORY_ACTIONS,
};

function repositoryRecord(ctx: PluginRecordContext): RecordRow {
  const cwd = codingRoot(ctx);
  return {
    id: GIT_REPOSITORY_ID,
    objectType: GIT_REPOSITORY_TYPE,
    data: {
      id: GIT_REPOSITORY_ID,
      cwd,
      tenant_id: ctx.tenantId,
    },
  };
}

function requireRepository(id: string): void {
  if (id !== GIT_REPOSITORY_ID) {
    throw Object.assign(new Error("Git repository not found"), {
      status: 404,
      code: "GIT_REPOSITORY_NOT_FOUND",
      retryable: false,
    });
  }
}

function optionalRemote(value: unknown): string | undefined {
  return value === undefined ? undefined : parseRemote(value);
}

function failed(result: { code: number; stdout: string; stderr: string }, command: string): never {
  throw Object.assign(
    new Error(result.stderr || result.stdout || `git ${command} failed`),
    { status: 422, code: "GIT_COMMAND_FAILED", retryable: false }
  );
}

export const gitRepositoryAdapter: PluginRecordAdapter = {
  list(query, ctx) {
    const offset = Math.max(Number(query.offset) || 0, 0);
    const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 500);
    const rows = offset === 0 && limit > 0 ? [repositoryRecord(ctx)] : [];
    return { objectType: GIT_REPOSITORY_TYPE, records: rows, total: 1 };
  },
  get(id, ctx) {
    return id === GIT_REPOSITORY_ID ? repositoryRecord(ctx) : null;
  },
  actions: {
    async branch(id, input, ctx) {
      requireRepository(id);
      const cwd = resolveWorkingRoot(ctx, input.cwd);
      const name = parseBranch(input.name);
      const create = parseBoolean(input.create, "create", false);
      const args = create ? ["checkout", "-b", name] : ["checkout", name];
      const result = await runGit(cwd, args, { signal: ctx.signal });
      if (result.code !== 0) failed(result, "checkout");
      return { ok: true, cwd, branch: name, created: create };
    },
    async add(id, input, ctx) {
      requireRepository(id);
      const cwd = resolveWorkingRoot(ctx, input.cwd);
      const paths = parsePaths(input.paths);
      const result = await runGit(cwd, ["add", "--", ...paths], { signal: ctx.signal });
      if (result.code !== 0) failed(result, "add");
      return { ok: true, cwd, staged: paths };
    },
    async commit(id, input, ctx) {
      requireRepository(id);
      const cwd = resolveWorkingRoot(ctx, input.cwd);
      const args = ["commit", "-m", parseMessage(input.message)];
      if (parseBoolean(input.skipHooks, "skipHooks", false)) args.push("--no-verify");
      rejectDestructiveGitArgs(args);
      const result = await runGit(cwd, args, { timeoutMs: 180_000, signal: ctx.signal });
      if (result.code !== 0) failed(result, "commit");
      const head = await runGit(cwd, ["rev-parse", "HEAD"], { signal: ctx.signal });
      if (head.code !== 0) failed(head, "rev-parse");
      return { ok: true, cwd, sha: head.stdout.trim(), stdout: result.stdout };
    },
    async push(id, input, ctx) {
      requireRepository(id);
      const cwd = resolveWorkingRoot(ctx, input.cwd);
      const remote = parseRemote(input.remote);
      const current = await runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"], {
        signal: ctx.signal,
      });
      if (current.code !== 0) failed(current, "rev-parse");
      const branch = parseBranch(current.stdout.trim());
      if (branch === "HEAD") {
        throw Object.assign(new Error("Detached HEAD; check out a branch first"), {
          status: 409,
          code: "GIT_DETACHED_HEAD",
          retryable: false,
        });
      }
      const args = ["push"];
      if (parseBoolean(input.setUpstream, "setUpstream", true)) args.push("-u");
      args.push(remote, `HEAD:refs/heads/${branch}`);
      rejectDestructiveGitArgs(args);
      const result = await runGit(cwd, args, { timeoutMs: 300_000, signal: ctx.signal });
      if (result.code !== 0) failed(result, "push");
      return {
        ok: true,
        cwd,
        branch,
        remote,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    },
    async fetch(id, input, ctx) {
      requireRepository(id);
      const cwd = resolveWorkingRoot(ctx, input.cwd);
      const remote = optionalRemote(input.remote);
      const args = remote ? ["fetch", remote] : ["fetch"];
      const result = await runGit(cwd, args, { timeoutMs: 300_000, signal: ctx.signal });
      if (result.code !== 0) failed(result, "fetch");
      return {
        ok: true,
        cwd,
        ...(remote ? { remote } : {}),
        stdout: result.stdout,
        stderr: result.stderr,
        code: result.code,
      };
    },
    async pull(id, input, ctx) {
      requireRepository(id);
      const cwd = resolveWorkingRoot(ctx, input.cwd);
      const remote = optionalRemote(input.remote);
      const args = ["pull"];
      if (parseBoolean(input.ffOnly, "ffOnly", true)) args.push("--ff-only");
      if (remote) args.push(remote);
      rejectDestructiveGitArgs(args);
      const result = await runGit(cwd, args, { timeoutMs: 300_000, signal: ctx.signal });
      if (result.code !== 0) failed(result, "pull");
      return {
        ok: true,
        cwd,
        ...(remote ? { remote } : {}),
        stdout: result.stdout,
      };
    },
  },
};

export function actionInput(args: Record<string, unknown>): RecordData {
  return { ...args };
}
