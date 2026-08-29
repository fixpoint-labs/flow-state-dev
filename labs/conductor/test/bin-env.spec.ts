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
  leftoverConductorKnobs,
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
      expect(formatRepoMismatch(mismatch!)).toContain("CONDUCTOR_REPO");
      expect(formatRepoMismatch(mismatch!)).toContain("CONDUCTOR_EPIC");
      expect(formatRepoMismatch(mismatch!)).toContain("CONDUCTOR_CHECKOUTS");
      expect(formatRepoMismatch(mismatch!)).toMatch(/together/);
      expect(formatRepoMismatch(mismatch!)).not.toContain("CONDUCTOR_MAX_ATTEMPTS");
    } finally {
      rmSync(here, { recursive: true, force: true });
      rmSync(leftover, { recursive: true, force: true });
    }
  });

  it("names leftover knobs that still apply after the trio is unset", () => {
    const here = scratch();
    const leftover = scratch();
    try {
      const mismatch = conductorRepoMismatch({ CONDUCTOR_REPO: leftover }, here, labRoot);
      const msg = formatRepoMismatch(mismatch!, {
        CONDUCTOR_MAX_ATTEMPTS: "2",
        CONDUCTOR_AGENT_MODEL: "claude-haiku-4-5",
        CONDUCTOR_RUN_TIMEOUT_MS: "600000",
        CONDUCTOR_BASE_REF: "main",
        CONDUCTOR_CONFIG: "/lab/fsdev.config.ts",
        CONDUCTOR_EPIC: "atlas-prove-add-bye",
      });
      expect(msg).toContain("CONDUCTOR_MAX_ATTEMPTS");
      expect(msg).toContain("CONDUCTOR_AGENT_MODEL");
      expect(msg).toContain("CONDUCTOR_RUN_TIMEOUT_MS");
      expect(msg).toContain("CONDUCTOR_BASE_REF");
      expect(msg).toMatch(/still set and will apply/);
      expect(msg).not.toContain("CONDUCTOR_CONFIG");
      expect(msg.split("\n").some((line) => line.includes("CONDUCTOR_EPIC") && line.includes("together"))).toBe(
        true,
      );
      expect(msg.split("\n").filter((line) => line.includes("CONDUCTOR_EPIC")).length).toBe(1);
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

  it("ignores blank leftover knobs and the bin-filled config", () => {
    expect(
      leftoverConductorKnobs({
        CONDUCTOR_MAX_ATTEMPTS: "  ",
        CONDUCTOR_AGENT_MODEL: "",
        CONDUCTOR_CONFIG: "/lab/fsdev.config.ts",
        CONDUCTOR_REPO: "/other",
        CONDUCTOR_RUN_TIMEOUT_MS: "600000",
      }),
    ).toEqual(["CONDUCTOR_RUN_TIMEOUT_MS"]);
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
