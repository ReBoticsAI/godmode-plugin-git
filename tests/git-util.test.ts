import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseBoolean,
  parseBranch,
  parseLimit,
  parsePaths,
  parseRemote,
  parseRevision,
  resolveWorkingRoot,
} from "../src/git-util.js";

describe("Git option validation", () => {
  it("accepts bounded typed options", () => {
    expect(parseBoolean(undefined, "flag", true)).toBe(true);
    expect(parseBoolean(false, "flag", true)).toBe(false);
    expect(parseLimit(50)).toBe(50);
    expect(parseBranch("feat/kernel-migration")).toBe("feat/kernel-migration");
    expect(parseRemote("upstream/team")).toBe("upstream/team");
    expect(parsePaths(["--help", "src/file.ts"])).toEqual([
      "--help",
      "src/file.ts",
    ]);
  });

  it("rejects coercion and option-shaped revisions", () => {
    expect(() => parseBoolean("false", "flag", true)).toThrow(
      "flag must be a boolean"
    );
    expect(() => parseLimit(1.5)).toThrow();
    expect(() => parseLimit(51)).toThrow();
    expect(() => parseRevision("--output=x", "base")).toThrow();
    expect(() => parseBranch("../main")).toThrow();
    expect(() => parseRemote("-c")).toThrow();
  });
});

describe("coding-root containment", () => {
  let root = "";
  let outside = "";
  const previous = { ...process.env };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "godmode-git-root-"));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), "godmode-git-outside-"));
    fs.mkdirSync(path.join(root, "nested"));
    process.env.DEPLOYMENT_MODE = "local";
    process.env.PLATFORM_REPO_ROOT = root;
  });

  afterEach(() => {
    process.env = { ...previous };
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("allows only existing directories beneath the root", () => {
    expect(resolveWorkingRoot({ tenantId: "tenant-a" }, "nested")).toBe(
      fs.realpathSync.native(path.join(root, "nested"))
    );
    expect(() =>
      resolveWorkingRoot({ tenantId: "tenant-a" }, outside)
    ).toThrow("Path escapes coding root");
    expect(() =>
      resolveWorkingRoot({ tenantId: "tenant-a" }, "missing")
    ).toThrow("Working directory not found");
  });
});
