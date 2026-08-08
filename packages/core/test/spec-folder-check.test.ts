import { describe, expect, it } from "vitest";
// @ts-expect-error — root check script, plain .mjs with no type declarations.
import { scanFiles, scanRoots, scanSources } from "../../../scripts/validate-spec-folder.mjs";

type Hit = { file: string; line: number; text: string };
type Result = { hits: Hit[]; retired: Hit[] };

const scan = (text: string, path = "packages/core/src/fixture.ts"): Result =>
  (scanSources as (s: Array<{ path: string; text: string }>) => Result)([{ path, text }]);

/**
 * The guard's whole value is that it fires on a real dangling citation and stays
 * quiet on the docs that have to name the path shape. Both halves are regex, so
 * both are pinned here rather than discovered by a red CI run on someone's PR.
 */
describe("spec citations — concrete paths are dangling, placeholders are not", () => {
  it("flags an issue spec cited by repo path", () => {
    const { hits } = scan("// see spec/FIX-123.md for the rationale");
    expect(hits.map((h) => h.text)).toEqual(["spec/FIX-123.md"]);
  });

  it("flags an epic spec cited by repo path — an epic PR never merges either", () => {
    const { hits } = scan("// see spec/_epics/task-substrate.md");
    expect(hits.map((h) => h.text)).toEqual(["spec/_epics/task-substrate.md"]);
  });

  it("ignores the issue-spec placeholder that every process doc writes", () => {
    expect(scan("specs live at spec/<ISSUE-ID>.md on their branch").hits).toEqual([]);
  });

  it("ignores the epic-spec placeholder", () => {
    expect(scan("the doc lives at spec/_epics/<name>.md on that branch").hits).toEqual([]);
  });

  it("does not double-report a retired docs/specs/ path as a spec citation", () => {
    const { hits, retired } = scan("// see docs/specs/FIX-123.md");
    expect(hits).toEqual([]);
    expect(retired.map((h) => h.text)).toEqual(["docs/specs/FIX-123.md"]);
  });

  it("reports the line number, so the failure names where to look", () => {
    const { hits } = scan("first\nsecond\n// spec/FIX-7.md");
    expect(hits[0]?.line).toBe(3);
  });
});

describe("exempt lists — the docs that define the convention may name it", () => {
  it("lets docs/contributing/ cite a spec path", () => {
    expect(scan("write it to spec/FIX-123.md", "docs/contributing/orchestration.md").hits).toEqual(
      [],
    );
  });

  it("lets docs/internal/ keep the historical docs/specs/ record", () => {
    expect(scan("was docs/specs/FIX-1.md", "docs/internal/spec-process-review.md").retired).toEqual(
      [],
    );
  });

  it("does NOT exempt a root doc — AGENTS.md is a maintained surface, not a carve-out", () => {
    expect(scan("see spec/FIX-123.md", "AGENTS.md").hits).toHaveLength(1);
  });

  it("does not exempt package source", () => {
    expect(scan("see spec/FIX-123.md", "packages/engine/src/run.ts").hits).toHaveLength(1);
  });
});

describe("scanned surface", () => {
  it("reaches the root-level docs that no scanned tree contains", () => {
    expect(scanFiles).toEqual(expect.arrayContaining(["README.md", "CLAUDE.md", "AGENTS.md"]));
  });

  it("includes .github, where the workflows describe the spec convention", () => {
    expect(scanRoots).toContain(".github");
  });
});
