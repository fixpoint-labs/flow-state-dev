/**
 * Architect fence: one Cursor harness stack, no second path, no product teaching.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const SKILL = readFileSync(resolve(ROOT, "../../.agents/skills/fsd-coding/SKILL.md"), "utf8");
const README = readFileSync(join(ROOT, "README.md"), "utf8");
const PKG = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

const OTHER_HARNESS = [
  "@flow-state-dev/codex",
  "@flow-state-dev/claude-code",
  "@flow-state-dev/harness-manager",
  "@flow-state-dev/workforce",
  "@flow-state-dev/chat-sdk",
  "@flow-state-dev/orchestration",
];

const PRODUCT_TEACHING = /Conductor|Workforce|TeamFlow|MessageBoard|pi-tui|Atlas|chat-sdk|FIX-1320|\bCodex\b/i;

function readDirTs(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => readFileSync(join(dir, name), "utf8"));
}

describe("one harness stack", () => {
  it("depends on @flow-state-dev/cursor and no other harness package", () => {
    expect(PKG.dependencies["@flow-state-dev/cursor"]).toBe("workspace:*");
    for (const name of OTHER_HARNESS) {
      expect(PKG.dependencies[name]).toBeUndefined();
      expect(PKG.devDependencies[name]).toBeUndefined();
    }
  });

  it("source imports only the Cursor harness", () => {
    const sources = readDirTs(join(ROOT, "src")).join("\n");
    expect(sources).toMatch(/from "@flow-state-dev\/cursor"/);
    for (const name of OTHER_HARNESS) {
      expect(sources).not.toContain(name);
    }
  });
});

describe("skill and lab docs do not teach other products", () => {
  it("the skill never names a competing product surface", () => {
    expect(SKILL).not.toMatch(PRODUCT_TEACHING);
    expect(SKILL).toMatch(/Cursor harness/);
  });

  it("the lab README never names a competing product surface", () => {
    expect(README).not.toMatch(PRODUCT_TEACHING);
    expect(README).toMatch(/@flow-state-dev\/cursor/);
  });
});
