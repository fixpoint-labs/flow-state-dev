/**
 * The lab bin fills blank env. The config door still refuses an unset
 * CONDUCTOR_REPO — this suite pins that the bin is the only filler, and
 * that an explicit value wins.
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyConductorBinDefaults } from "../bin/env.mjs";

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
