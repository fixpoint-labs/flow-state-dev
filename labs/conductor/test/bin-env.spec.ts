/**
 * The lab bin fills blank env. The config door still refuses an unset
 * CONDUCTOR_REPO — this suite pins that the bin is the only filler, and
 * that an explicit value wins.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyConductorBinDefaults,
  conductorRepoMismatch,
  formatRepoMismatch,
  gitToplevel,
} from "../bin/env.mjs";
import { seedRepo } from "./harness";

const labRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("applyConductorBinDefaults", () => {
  it("fills CONDUCTOR_CONFIG and CONDUCTOR_REPO when both are unset", () => {
    const env: NodeJS.ProcessEnv = {};
    applyConductorBinDefaults(env, labRoot);
    expect(env.CONDUCTOR_CONFIG).toBe(path.join(labRoot, "fsdev.config.ts"));
    expect(env.CONDUCTOR_REPO).toBe(".");
  });

  it("ignores blank CONDUCTOR_CONFIG and CONDUCTOR_REPO the same as unset", () => {
    const env: NodeJS.ProcessEnv = { CONDUCTOR_CONFIG: "  ", CONDUCTOR_REPO: "" };
    applyConductorBinDefaults(env, labRoot);
    expect(env.CONDUCTOR_CONFIG).toBe(path.join(labRoot, "fsdev.config.ts"));
    expect(env.CONDUCTOR_REPO).toBe(".");
  });

  it("does not overwrite an explicit CONDUCTOR_CONFIG or CONDUCTOR_REPO", () => {
    const env: NodeJS.ProcessEnv = {
      CONDUCTOR_CONFIG: "/other/fsdev.config.ts",
      CONDUCTOR_REPO: "/other/product",
    };
    applyConductorBinDefaults(env, labRoot);
    expect(env.CONDUCTOR_CONFIG).toBe("/other/fsdev.config.ts");
    expect(env.CONDUCTOR_REPO).toBe("/other/product");
  });
});

describe("root pnpm conductor", () => {
  it("invokes the lab bin without changing cwd", () => {
    const rootPkg = JSON.parse(
      readFileSync(path.resolve(labRoot, "../../package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    expect(rootPkg.scripts?.conductor).toBe("node labs/conductor/bin/conductor.mjs");
    expect(rootPkg.scripts?.conductor).not.toMatch(/--dir/);
  });
});

describe("conductorRepoMismatch", () => {
  function scratch(): string {
    const dir = mkdtempSync(path.join(tmpdir(), "conductor-bin-repo-"));
    seedRepo(dir);
    return dir;
  }

  it("is undefined when CONDUCTOR_REPO is this checkout", () => {
    const here = scratch();
    try {
      const env: NodeJS.ProcessEnv = {};
      applyConductorBinDefaults(env, labRoot);
      expect(conductorRepoMismatch(env, here, labRoot)).toBeUndefined();
      env.CONDUCTOR_REPO = here;
      expect(conductorRepoMismatch(env, here, labRoot)).toBeUndefined();
    } finally {
      rmSync(here, { recursive: true, force: true });
    }
  });

  it("names both trees when leftover CONDUCTOR_REPO is a different checkout", () => {
    const here = scratch();
    const leftover = scratch();
    try {
      const mismatch = conductorRepoMismatch({ CONDUCTOR_REPO: leftover }, here, labRoot);
      expect(mismatch).toEqual({
        cwdRoot: gitToplevel(here),
        repoRoot: gitToplevel(leftover),
      });
      expect(formatRepoMismatch(mismatch!)).toContain(leftover);
      expect(formatRepoMismatch(mismatch!)).toContain(here);
      expect(formatRepoMismatch(mismatch!)).toContain("Unset CONDUCTOR_REPO");
    } finally {
      rmSync(here, { recursive: true, force: true });
      rmSync(leftover, { recursive: true, force: true });
    }
  });

  it("allows the dispatcher to name a product checkout", () => {
    const product = scratch();
    const dispatcher = gitToplevel(labRoot);
    expect(dispatcher).toBeDefined();
    expect(
      conductorRepoMismatch({ CONDUCTOR_REPO: product }, dispatcher!, labRoot),
    ).toBeUndefined();
    rmSync(product, { recursive: true, force: true });
  });

  it("is undefined when cwd is not a git checkout", () => {
    const leftover = scratch();
    const plain = mkdtempSync(path.join(tmpdir(), "conductor-bin-plain-"));
    try {
      expect(conductorRepoMismatch({ CONDUCTOR_REPO: leftover }, plain, labRoot)).toBeUndefined();
    } finally {
      rmSync(leftover, { recursive: true, force: true });
      rmSync(plain, { recursive: true, force: true });
    }
  });
});
