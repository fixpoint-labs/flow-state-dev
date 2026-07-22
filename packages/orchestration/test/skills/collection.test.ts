/**
 * Schema-shape tests for the skills collection.
 *
 * The `skills/**` pattern holds heterogeneous entries — SKILL.md manifests,
 * supporting files (`reference/*.md`, `scripts/*.py`), and a `_meta` entry
 * — under a single uniformly-applied state schema. Every `collection.create`
 * call passes through this schema, so it has to accept all three shapes.
 *
 * Regression guard: a prior version required `description` at the schema
 * level, which rejected supporting files and `_meta` at seed time and
 * cascaded into a runSkill tool error.
 */
import { describe, expect, it } from "vitest";
import { skillFileKey, skillStateSchema } from "../../src/skills/collection";

describe("skillStateSchema", () => {
  it("accepts a fully-populated manifest state", () => {
    expect(() =>
      skillStateSchema.parse({
        description: "Run a thing",
        allowedTools: ["search"],
        contextMode: "inline",
        disableModelInvocation: false,
        whenToUse: "When X happens",
        argumentHint: "<topic>",
        _seededAt: "2026-04-23T00:00:00Z",
      }),
    ).not.toThrow();
  });

  it("accepts a supporting-file empty state", () => {
    expect(() => skillStateSchema.parse({})).not.toThrow();
  });

  it("accepts a _meta state with only seededNames", () => {
    expect(() =>
      skillStateSchema.parse({ seededNames: ["skill-a", "skill-b"] }),
    ).not.toThrow();
  });

  it("accepts extra passthrough fields without complaint", () => {
    expect(() =>
      skillStateSchema.parse({ description: "x", custom: "anything" }),
    ).not.toThrow();
  });

  // The schema is intentionally permissive (passthrough) so it never drops
  // author-declared fields the framework hasn't explicitly modeled. A
  // delegation skill's `workers:` map (FIX-918) must survive a parse
  // round-trip rather than being wiped by state normalization.
  it("round-trips a delegation `workers` map via passthrough", () => {
    const state = {
      description: "Multi-angle research",
      contextMode: "inline" as const,
      workers: {
        analyst: { promptRef: "./reference/analyst.md" },
      },
    };
    const parsed = skillStateSchema.parse(state);
    expect(parsed.contextMode).toBe("inline");
    expect((parsed as { workers?: unknown }).workers).toEqual(state.workers);
  });
});

describe("skillFileKey", () => {
  it("joins a bare relative path", () => {
    expect(skillFileKey("comp-analysis", "reference/x.md")).toBe(
      "comp-analysis/reference/x.md",
    );
  });

  // Regression: a pattern-skill worker spec with `prompt-ref: ./reference/x.md`
  // was producing `comp-analysis/./reference/x.md` and missing the seeded file.
  it("strips leading './' so authors can use either form", () => {
    expect(skillFileKey("comp-analysis", "./reference/x.md")).toBe(
      "comp-analysis/reference/x.md",
    );
  });

  it("collapses interior './' segments", () => {
    expect(skillFileKey("s", "a/./b/./c.md")).toBe("s/a/b/c.md");
  });

  it("strips leading slashes", () => {
    expect(skillFileKey("s", "/a/b.md")).toBe("s/a/b.md");
  });

  it("rejects '..' segments to keep files inside the skill folder", () => {
    expect(() => skillFileKey("s", "../other/x.md")).toThrow(/\.\./);
    expect(() => skillFileKey("s", "a/../../x.md")).toThrow(/\.\./);
  });
});
