import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseBranch, parseRemote, runGit } from "../src/git-util.js";
import { GIT_REPOSITORY_ID, gitRepositoryAdapter } from "../src/kernel.js";

describe("Git argument injection resistance", () => {
  let root = "";
  const previous = { ...process.env };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "godmode-git-injection-"));
    process.env.DEPLOYMENT_MODE = "local";
    process.env.PLATFORM_REPO_ROOT = root;
    const initialized = spawnSync("git", ["init"], {
      cwd: root,
      shell: false,
      windowsHide: true,
    });
    if (initialized.status !== 0) {
      throw new Error(initialized.stderr.toString());
    }
  });

  afterEach(() => {
    process.env = { ...previous };
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("never interprets Git arguments through a Windows shell", async () => {
    const marker = path.join(root, "shell-injection-marker");
    await runGit(root, [
      "status",
      "--",
      "&",
      "powershell",
      "-NoProfile",
      "-Command",
      `New-Item -ItemType File -Path '${marker}'`,
    ]);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("uses an option terminator for option-shaped pathspecs", async () => {
    fs.writeFileSync(path.join(root, "--help"), "safe pathspec");
    const add = gitRepositoryAdapter.actions?.add;
    expect(add).toBeDefined();
    await add?.(
      GIT_REPOSITORY_ID,
      { paths: ["--help"] },
      { tenantId: "tenant-a", role: "owner", source: "plugin" }
    );
    const status = await runGit(root, ["status", "--porcelain=v1"]);
    expect(status.stdout).toContain("--help");
  });

  it("rejects branch and remote command fragments before spawn", () => {
    expect(() => parseBranch("safe & powershell")).toThrow();
    expect(() => parseBranch("--upload-pack=evil")).toThrow();
    expect(() => parseRemote("origin;whoami")).toThrow();
    expect(() => parseRemote("--exec=evil")).toThrow();
  });
});
