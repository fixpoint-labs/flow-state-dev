/**
 * The skill text is the fence the outer agent reads. If it softens, the
 * POC no longer forces work through FSD.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SKILL = readFileSync(
  resolve(import.meta.dirname, "../../../.agents/skills/fsd-coding/SKILL.md"),
  "utf8",
);

describe("fsd-coding skill", () => {
  it("names the runner as the mandatory path", () => {
    expect(SKILL).toMatch(/@flow-state-dev\/fsd-coding-skill/);
    expect(SKILL).toMatch(/You MUST drive (all )?coding work through (this|the) runner/i);
    expect(SKILL).toMatch(/implement/);
    expect(SKILL).toMatch(/fix-fsd|fixFsd/);
  });

  it("forbids escaping around FSD except where auth cannot go through the harness", () => {
    expect(SKILL).toMatch(/do not (just )?use git\/gh directly/i);
    expect(SKILL).toMatch(/auth/i);
    expect(SKILL).not.toMatch(/fall back to Conductor/i);
    expect(SKILL).not.toMatch(/use Workforce/i);
  });

  it("requires fixFsd with a repro before retrying a failed door", () => {
    expect(SKILL).toMatch(/fix-fsd|fixFsd/);
    expect(SKILL).toMatch(/repro/i);
    expect(SKILL).toMatch(/before retrying/i);
  });
});
