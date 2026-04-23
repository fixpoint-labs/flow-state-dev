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
import { skillStateSchema } from "../src/collection";

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
});
