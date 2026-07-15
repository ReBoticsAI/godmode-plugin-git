import { validateObjectTypeDef } from "@godmode/kernel";
import {
  KERNEL_CLIENT_API_VERSION,
  readGodmodePluginManifest,
} from "@godmode/plugin-api";
import { describe, expect, it, vi } from "vitest";
import { assertKernelClientVersion, register } from "../src/bridge.js";
import {
  GIT_REPOSITORY_ACTIONS,
  GIT_REPOSITORY_DEFINITION,
} from "../src/kernel.js";

describe("GitRepository action contract", () => {
  it("declares and requires kernel client API version 1", () => {
    const manifest = readGodmodePluginManifest(process.cwd());
    expect(manifest.kernelApiVersion).toBe(KERNEL_CLIENT_API_VERSION);
    expect(KERNEL_CLIENT_API_VERSION).toBe(1);
    expect(() =>
      assertKernelClientVersion({ apiVersion: 2 } as never)
    ).toThrow(
      "godmode-plugin-git requires kernel client API 1; host provided 2"
    );
  });

  it("fails before registration when the host client version mismatches", () => {
    const registerObjectType = vi.fn();
    const registerTools = vi.fn();
    expect(() =>
      register({
        kernel: { apiVersion: 2 },
        objectTypes: { register: registerObjectType },
        tools: { register: registerTools },
      } as never)
    ).toThrow(/requires kernel client API 1; host provided 2/);
    expect(registerObjectType).not.toHaveBeenCalled();
    expect(registerTools).not.toHaveBeenCalled();
  });

  it("is valid and fully declares operational policy", () => {
    expect(validateObjectTypeDef(GIT_REPOSITORY_DEFINITION)).toEqual([]);
    expect(GIT_REPOSITORY_ACTIONS.map((action) => action.name)).toEqual([
      "branch",
      "add",
      "commit",
      "push",
      "fetch",
      "pull",
    ]);
    for (const action of GIT_REPOSITORY_ACTIONS) {
      expect(action.roles).toEqual(["editor", "owner", "intelligence"]);
      expect(action.confirmation).toEqual({ required: true, ttlSeconds: 300 });
      expect(action.idempotency).toBeDefined();
      expect(action.timeoutMs).toBeGreaterThan(0);
      expect(action.inputSchema).toMatchObject({ additionalProperties: false });
      expect(action.outputSchema).toBeDefined();
      expect(action.errorSchema).toBeDefined();
      expect(action.events).toHaveLength(1);
    }
    expect(
      GIT_REPOSITORY_ACTIONS.find((action) => action.name === "fetch")
    ).toMatchObject({
      effect: "external",
      confirmation: { required: true },
    });
  });

  it("registers measured semantic wrappers and fixes branch naming", async () => {
    const runAction = vi.fn().mockResolvedValue({ ok: true });
    let tools: Array<Record<string, unknown>> = [];
    let registeredDefinition: unknown;
    const api = {
      objectTypes: {
        register(definition: unknown) {
          registeredDefinition = definition;
          return { dispose() {} };
        },
      },
      tools: {
        register(value: Array<Record<string, unknown>>) {
          tools = value;
        },
      },
      kernel: { apiVersion: KERNEL_CLIENT_API_VERSION, runAction },
    };
    register(api as never);

    expect(registeredDefinition).toBe(GIT_REPOSITORY_DEFINITION);
    expect(tools.some((tool) => tool.name === "git_branch")).toBe(true);
    expect(tools.some((tool) => tool.name === "git_checkout")).toBe(false);
    expect(tools.find((tool) => tool.name === "git_fetch")).toMatchObject({
      mode: "confirm",
    });

    const branch = tools.find((tool) => tool.name === "git_branch") as {
      handler: (
        input: Record<string, unknown>,
        ctx: Record<string, unknown>
      ) => Promise<unknown>;
    };
    await branch.handler(
      { name: "feat/safe", create: true },
      { tenantId: "tenant-a", activeAgentId: "agent-a" }
    );
    expect(runAction).toHaveBeenCalledWith(
      "GitRepository",
      "branch",
      { name: "feat/safe", create: true },
      expect.objectContaining({
        tenantId: "tenant-a",
        activeAgentId: "agent-a",
        role: "intelligence",
      }),
      "coding-root"
    );
  });

  it("converts confirmed tool approval into a kernel confirmation grant", async () => {
    const confirmation = Object.assign(new Error("confirmation required"), {
      status: 428,
      code: "KERNEL_CONFIRMATION_REQUIRED",
      details: { confirmationId: "grant-1" },
    });
    const runAction = vi
      .fn()
      .mockRejectedValueOnce(confirmation)
      .mockResolvedValueOnce({ ok: true });
    let tools: Array<Record<string, unknown>> = [];
    register({
      objectTypes: { register: () => ({ dispose() {} }) },
      tools: { register: (value: Array<Record<string, unknown>>) => (tools = value) },
      kernel: { apiVersion: KERNEL_CLIENT_API_VERSION, runAction },
    } as never);
    const fetch = tools.find((tool) => tool.name === "git_fetch") as {
      handler: (
        input: Record<string, unknown>,
        ctx: Record<string, unknown>
      ) => Promise<unknown>;
    };
    await expect(fetch.handler({}, { tenantId: "tenant-a" })).resolves.toEqual({
      ok: true,
    });
    expect(runAction).toHaveBeenLastCalledWith(
      "GitRepository",
      "fetch",
      {},
      expect.objectContaining({ confirmationId: "grant-1" }),
      "coding-root"
    );
  });
});
