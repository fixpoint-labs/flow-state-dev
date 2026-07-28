/**
 * Contract tests for the shared bundled-file lookup.
 *
 * `findBundledFile` has two callers that resolve the SAME `prompt-ref` at
 * different times: `library.ts` validates a static agent's ref at build time,
 * and `delegation-surface.ts` inlines the body at materialization time. They
 * were separate copies of the same matching rule before this module existed, so
 * these tests pin the rule itself — a divergence means a skill passes build
 * validation and then fails to materialize (or the reverse: a skill rejected at
 * build time that would in fact have resolved).
 */
import { describe, expect, it } from "vitest";
import type { SkillFile } from "@flow-state-dev/core";
import { findBundledFile } from "../../src/skills/internal/bundled-files";

const files: SkillFile[] = [
  { path: "prompts/researcher.md", content: "You research." },
  { path: "./prompts/writer.md", content: "You write." },
];

describe("findBundledFile", () => {
  it("matches a plain path", () => {
    expect(findBundledFile(files, "prompts/researcher.md")?.content).toBe("You research.");
  });

  it("matches a ref written with a leading ./ against a plain stored path", () => {
    expect(findBundledFile(files, "./prompts/researcher.md")?.content).toBe("You research.");
  });

  it("matches a plain ref against a stored path written with a leading ./", () => {
    expect(findBundledFile(files, "prompts/writer.md")?.content).toBe("You write.");
  });

  it("matches a leading-slash ref", () => {
    expect(findBundledFile(files, "/prompts/researcher.md")?.content).toBe("You research.");
  });

  it("returns undefined for a ref no file provides", () => {
    expect(findBundledFile(files, "prompts/missing.md")).toBeUndefined();
  });

  // The build-time validator calls this on skills that bundle nothing at all;
  // it must report "no such file" rather than throwing on the absent list.
  it("returns undefined when the skill bundles no files", () => {
    expect(findBundledFile(undefined, "prompts/researcher.md")).toBeUndefined();
    expect(findBundledFile([], "prompts/researcher.md")).toBeUndefined();
  });

  // Deliberate scope limit, shared with the pre-existing inline copies this
  // module replaced: only leading `./` and `/` are stripped. Interior `.`
  // segments are NOT collapsed, so this does not match `skillFileKey`'s
  // `normalizeSkillFilePath`. Pinned so the divergence is visible if someone
  // unifies the two rules later.
  it("does not collapse interior . segments", () => {
    expect(findBundledFile(files, "prompts/./researcher.md")).toBeUndefined();
  });
});
