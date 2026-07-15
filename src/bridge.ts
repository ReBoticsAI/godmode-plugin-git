import type {
  GodModePluginRegister,
  PluginKernelClient,
  PluginRecordContext,
  PluginToolHandler,
} from "@godmode/plugin-api";
import { KERNEL_CLIENT_API_VERSION } from "@godmode/plugin-api";
import {
  parseBoolean,
  parseLimit,
  parsePath,
  parseRevision,
  resolveWorkingRoot,
  runGit,
} from "./git-util.js";
import {
  GIT_REPOSITORY_DEFINITION,
  GIT_REPOSITORY_ID,
  GIT_REPOSITORY_TYPE,
  gitRepositoryAdapter,
} from "./kernel.js";

const cwd = {
  cwd: {
    type: "string",
    minLength: 1,
    maxLength: 4_096,
    description: "Directory within the tenant coding root",
  },
};

function recordContext(
  ctx: Parameters<PluginToolHandler>[1],
  confirmationId?: string
): PluginRecordContext {
  return {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    activeAgentId: ctx.activeAgentId ?? "godmode-plugin-git",
    activeSubtaskCardId: ctx.activeSubtaskCardId,
    activeTaskCardId: ctx.activeTaskCardId,
    role: "intelligence",
    source: "agent",
    confirmationId,
  };
}

function confirmationId(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = error as {
    status?: number;
    code?: string;
    details?: { confirmationId?: unknown };
  };
  if (
    value.status !== 428 &&
    value.code !== "KERNEL_CONFIRMATION_REQUIRED"
  ) {
    return undefined;
  }
  return typeof value.details?.confirmationId === "string"
    ? value.details.confirmationId
    : undefined;
}

async function delegate(
  kernel: PluginKernelClient,
  action: string,
  args: Record<string, unknown>,
  ctx: Parameters<PluginToolHandler>[1]
): Promise<unknown> {
  try {
    return await kernel.runAction(
      GIT_REPOSITORY_TYPE,
      action,
      { ...args },
      recordContext(ctx),
      GIT_REPOSITORY_ID
    );
  } catch (error) {
    // The compatibility tool has already passed its host confirmation gate.
    const grant = confirmationId(error);
    if (!grant) throw error;
    return kernel.runAction(
      GIT_REPOSITORY_TYPE,
      action,
      { ...args },
      recordContext(ctx, grant),
      GIT_REPOSITORY_ID
    );
  }
}

export function assertKernelClientVersion(
  kernel: Pick<PluginKernelClient, "apiVersion">
): void {
  if (kernel.apiVersion !== KERNEL_CLIENT_API_VERSION) {
    throw new Error(
      `godmode-plugin-git requires kernel client API ${KERNEL_CLIENT_API_VERSION}; ` +
        `host provided ${String(kernel.apiVersion)}`
    );
  }
}

const mutationTools = [
  {
    name: "git_branch",
    action: "branch",
    description: "Create and/or check out a branch through GitRepository.branch.",
    properties: {
      ...cwd,
      name: { type: "string", minLength: 1, maxLength: 255 },
      create: { type: "boolean", default: false },
    },
    required: ["name"],
  },
  {
    name: "git_add",
    action: "add",
    description: "Stage bounded pathspecs through GitRepository.add.",
    properties: {
      ...cwd,
      paths: {
        type: "array",
        minItems: 1,
        maxItems: 500,
        items: { type: "string", minLength: 1, maxLength: 1_024 },
      },
    },
    required: ["paths"],
  },
  {
    name: "git_commit",
    action: "commit",
    description: "Commit staged changes through GitRepository.commit.",
    properties: {
      ...cwd,
      message: { type: "string", minLength: 1, maxLength: 10_000 },
      skipHooks: { type: "boolean", default: false },
    },
    required: ["message"],
  },
  {
    name: "git_push",
    action: "push",
    description: "Push without force through GitRepository.push.",
    properties: {
      ...cwd,
      remote: { type: "string", minLength: 1, maxLength: 256, default: "origin" },
      setUpstream: { type: "boolean", default: true },
    },
  },
  {
    name: "git_fetch",
    action: "fetch",
    description: "Fetch through the confirmed external GitRepository.fetch action.",
    properties: {
      ...cwd,
      remote: { type: "string", minLength: 1, maxLength: 256 },
    },
  },
  {
    name: "git_pull",
    action: "pull",
    description: "Pull through GitRepository.pull with ff-only behavior by default.",
    properties: {
      ...cwd,
      remote: { type: "string", minLength: 1, maxLength: 256 },
      ffOnly: { type: "boolean", default: true },
    },
  },
] as const;

export const register: GodModePluginRegister = (api) => {
  assertKernelClientVersion(api.kernel);
  api.objectTypes.register(GIT_REPOSITORY_DEFINITION, gitRepositoryAdapter);
  api.tools.register([
    {
      name: "git_status",
      description: "Show branch and porcelain status inside the tenant coding root.",
      mode: "auto",
      parameters: { type: "object", properties: cwd, additionalProperties: false },
      handler: async (args, ctx) => {
        const root = resolveWorkingRoot(ctx, args.cwd);
        const branch = await runGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
        const status = await runGit(root, ["status", "--porcelain=v1", "-b"]);
        return {
          cwd: root,
          branch: branch.stdout.trim(),
          status: status.stdout,
          code: status.code,
          stderr: status.stderr || undefined,
        };
      },
    },
    {
      name: "git_diff",
      description: "Show staged, revision-range, or path-limited Git diff.",
      mode: "auto",
      parameters: {
        type: "object",
        properties: {
          ...cwd,
          staged: { type: "boolean" },
          base: { type: "string", minLength: 1, maxLength: 4_096 },
          head: { type: "string", minLength: 1, maxLength: 4_096 },
          pathspec: { type: "string", minLength: 1, maxLength: 1_024 },
        },
        additionalProperties: false,
      },
      handler: async (args, ctx) => {
        const root = resolveWorkingRoot(ctx, args.cwd);
        const gitArgs = ["diff"];
        if (parseBoolean(args.staged, "staged", false)) gitArgs.push("--cached");
        if (args.base !== undefined) {
          const base = parseRevision(args.base, "base");
          const head =
            args.head === undefined ? "HEAD" : parseRevision(args.head, "head");
          gitArgs.push(`${base}...${head}`);
        } else if (args.head !== undefined) {
          throw Object.assign(new Error("head requires base"), {
            status: 400,
            code: "GIT_INVALID_ARGUMENT",
          });
        }
        if (args.pathspec !== undefined) gitArgs.push("--", parsePath(args.pathspec));
        const result = await runGit(root, gitArgs);
        return {
          cwd: root,
          args: gitArgs,
          diff: result.stdout,
          code: result.code,
          stderr: result.stderr || undefined,
        };
      },
    },
    {
      name: "git_log",
      description: "Show a bounded number of recent commits.",
      mode: "auto",
      parameters: {
        type: "object",
        properties: {
          ...cwd,
          limit: { type: "integer", minimum: 1, maximum: 50, default: 15 },
        },
        additionalProperties: false,
      },
      handler: async (args, ctx) => {
        const root = resolveWorkingRoot(ctx, args.cwd);
        const result = await runGit(root, [
          "log",
          `-n${parseLimit(args.limit)}`,
          "--oneline",
          "--decorate",
        ]);
        return {
          cwd: root,
          log: result.stdout,
          code: result.code,
          stderr: result.stderr || undefined,
        };
      },
    },
    {
      name: "git_branches",
      description: "List local Git branches.",
      mode: "auto",
      parameters: { type: "object", properties: cwd, additionalProperties: false },
      handler: async (args, ctx) => {
        const root = resolveWorkingRoot(ctx, args.cwd);
        const result = await runGit(root, ["branch", "-vv"]);
        return {
          cwd: root,
          branches: result.stdout,
          code: result.code,
          stderr: result.stderr || undefined,
        };
      },
    },
    ...mutationTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      mode: "confirm" as const,
      parameters: {
        type: "object",
        properties: tool.properties,
        required: "required" in tool ? [...tool.required] : undefined,
        additionalProperties: false,
      },
      handler: ((args, ctx) =>
        delegate(api.kernel, tool.action, args, ctx)) satisfies PluginToolHandler,
    })),
  ]);
};
