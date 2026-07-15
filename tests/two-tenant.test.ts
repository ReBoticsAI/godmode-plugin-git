import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveWorkingRoot } from "../src/git-util.js";
import { GIT_REPOSITORY_ID, gitRepositoryAdapter } from "../src/kernel.js";

describe("two-tenant coding roots", () => {
  let dataDir = "";
  const previous = { ...process.env };

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "godmode-git-tenants-"));
    process.env.DEPLOYMENT_MODE = "hub";
    process.env.PLATFORM_DATA_DIR = dataDir;
    fs.mkdirSync(path.join(dataDir, "tenant-workspaces", "tenant-a"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(dataDir, "tenant-workspaces", "tenant-b"), {
      recursive: true,
    });
  });

  afterEach(() => {
    process.env = { ...previous };
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("binds records and cwd overrides to the active tenant", () => {
    const rootA = resolveWorkingRoot({ tenantId: "tenant-a" });
    const rootB = resolveWorkingRoot({ tenantId: "tenant-b" });
    expect(rootA).not.toBe(rootB);

    const rowA = gitRepositoryAdapter.get?.(GIT_REPOSITORY_ID, {
      tenantId: "tenant-a",
      role: "owner",
      source: "plugin",
    });
    const rowB = gitRepositoryAdapter.get?.(GIT_REPOSITORY_ID, {
      tenantId: "tenant-b",
      role: "owner",
      source: "plugin",
    });
    expect(rowA?.data.cwd).not.toBe(rowB?.data.cwd);
    expect(() =>
      resolveWorkingRoot({ tenantId: "tenant-a" }, rootB)
    ).toThrow("Path escapes coding root");
  });

  it("rejects tenant path traversal before root construction", () => {
    expect(() => resolveWorkingRoot({})).toThrow(
      "Tenant coding root requires tenantId"
    );
    expect(() => resolveWorkingRoot({ tenantId: "../tenant-b" })).toThrow(
      "tenantId is invalid"
    );
    expect(() => resolveWorkingRoot({ tenantId: ".." })).toThrow(
      "tenantId is invalid"
    );
  });
});
