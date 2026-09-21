import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error — root check script, plain .mjs with no type declarations.
import { scanSources } from "../../../scripts/validate-spec-folder.mjs";

type Hit = { file: string; line: number; text: string };
type Result = { hits: Hit[]; retired: Hit[] };

const scan = (text: string, path = "packages/core/src/fixture.ts"): Result =>
  (scanSources as (s: Array<{ path: string; text: string }>) => Result)([{ path, text }]);

/** Legacy and never-merged paths remain dangling; retained specs use specs/. */
describe("legacy spec citations — concrete paths are dangling, placeholders are not", () => {
  it("accepts external historical provenance without hiding a local citation on the same line", () => {
    const { hits, retired } = scan(
      "[Previous spec](https://github.com/example/project/blob/0123456/spec/FIX-101/SPEC.md) " +
        "[Older record](https://github.com/example/project/blob/0123456/docs/specs/FIX-100.md) " +
        "but spec/FIX-102/DECISIONS.md is still a dangling local citation. " +
        "[Historical](https://github.com/example/project/blob/0123456/spec/FIX-101/SPEC.md)" +
        "[Local](spec/FIX-103/SPEC.md)",
    );
    expect(hits.map((hit) => hit.text)).toEqual([
      "spec/FIX-102/DECISIONS.md",
      "spec/FIX-103/SPEC.md",
    ]);
    expect(retired).toEqual([]);
  });

  it("flags a document in an issue spec's directory cited by repo path", () => {
    const { hits } = scan("// see spec/FIX-123/SPEC.md for the rationale");
    expect(hits.map((h) => h.text)).toEqual(["spec/FIX-123/SPEC.md"]);
  });

  it("flags a figure in an issue spec's directory — it dies with the branch like the prose", () => {
    const { hits } = scan("![drawers](spec/FIX-123/figures/drawers.svg)");
    expect(hits.map((h) => h.text)).toEqual(["spec/FIX-123/figures/drawers.svg"]);
  });

  it("flags the legacy epic directory, which is not retained under specs/epics/", () => {
    const { hits } = scan("// see spec/_epics/task-substrate/PLAN.md");
    expect(hits.map((h) => h.text)).toEqual(["spec/_epics/task-substrate/PLAN.md"]);
  });

  it("flags a document in a project spec's directory — a project PR never merges either", () => {
    const { hits } = scan("// see spec/_projects/streaming/BUSINESS-RULES.md");
    expect(hits.map((h) => h.text)).toEqual(["spec/_projects/streaming/BUSINESS-RULES.md"]);
  });

  it("still flags the pre-directory shape, which is just as dangling", () => {
    const { hits } = scan("// see spec/FIX-123.md and spec/_epics/task-substrate.md");
    expect(hits.map((h) => h.text)).toEqual(["spec/FIX-123.md", "spec/_epics/task-substrate.md"]);
  });

  it("ignores the issue-spec placeholder that every process doc writes", () => {
    expect(scan("specs live at spec/<ISSUE-ID>/SPEC.md on their branch").hits).toEqual([]);
    expect(scan("figures at spec/<ISSUE-ID>/figures/<name>.svg").hits).toEqual([]);
  });

  it("ignores the epic-spec placeholder", () => {
    expect(scan("the set lives at spec/_epics/<name>/SPEC.md on that branch").hits).toEqual([]);
  });

  it("ignores the project-spec placeholder", () => {
    expect(scan("the set lives at spec/_projects/<slug>/SPEC.md on that branch").hits).toEqual([]);
    expect(scan("pinned at <sha>/spec/_projects/<slug>/figures/arc.svg").hits).toEqual([]);
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

/**
 * The exempt list stays short because the placeholder does the work: a doc that
 * describes the convention writes `<ISSUE-ID>`, which never matches, so it needs
 * no carve-out. Only a file that must quote a concrete path to match it is exempt.
 */
describe("exempt lists — narrow, because placeholders need no exemption", () => {
  it("does NOT exempt docs/contributing/ — a concrete path there is dangling too", () => {
    expect(
      scan("write it to spec/FIX-123/SPEC.md", "docs/contributing/orchestration.md").hits,
    ).toHaveLength(1);
  });

  it("does NOT exempt .agents/ — a skill citing a real spec path is a dead link", () => {
    expect(scan("see spec/FIX-999/PLAN.md", ".agents/skills/issue-spec/SKILL.md").hits).toHaveLength(1);
  });

  it("still lets docs/contributing/ write the placeholder form", () => {
    expect(
      scan("write it to spec/<ISSUE-ID>/SPEC.md", "docs/contributing/orchestration.md").hits,
    ).toEqual([]);
  });

  it("lets docs/internal/ keep the historical docs/specs/ record", () => {
    expect(scan("was docs/specs/FIX-1.md", "docs/internal/spec-process-review.md").retired).toEqual(
      [],
    );
  });

  it("does NOT exempt a root doc — AGENTS.md is a maintained surface, not a carve-out", () => {
    expect(scan("see spec/FIX-123/SPEC.md", "AGENTS.md").hits).toHaveLength(1);
  });

  it("does not exempt package source", () => {
    expect(scan("see spec/FIX-123/DECISIONS.md", "packages/engine/src/run.ts").hits).toHaveLength(1);
  });
});

/**
 * Run the actual CLI in a disposable repository layout, so assertions cover
 * discovered files and the process exit status rather than exported config.
 */
describe("retained specs through the guard CLI", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function check(files: Record<string, string>) {
    const root = mkdtempSync(join(tmpdir(), "spec-folder-check-"));
    roots.push(root);
    mkdirSync(join(root, "scripts"));
    const script = join(root, "scripts/validate-spec-folder.mjs");
    copyFileSync(new URL("../../../scripts/validate-spec-folder.mjs", import.meta.url), script);
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
    if (result.error) throw result.error;
    return result;
  }

  it("accepts retained documents, authored assets, POCs and citations to two predecessors", () => {
    const files: Record<string, string> = {
      "spec/README.md": "Project specs remain on their never-merged project branch.",
      "spec-poc/README.md": "Legacy POCs remain isolated.",
      "README.md": "[Direction](specs/issues/FIX-123/SPEC.md#direction)",
      "packages/core/src/fixture.ts": "// Rationale: specs/epics/FIX-100/DECISIONS.md#ownership",
      "specs/issues/FIX-123/EVOLUTION.md":
        "[Amends ownership](../../epics/FIX-100/DECISIONS.md#ownership)\n" +
        "[Retains compatibility](../FIX-101/BUSINESS-RULES.md#compatibility)",
      "specs/issues/FIX-123/figures/flow.svg": "<svg xmlns=\"http://www.w3.org/2000/svg\"/>",
      "specs/issues/FIX-123/assets/example.json": "{\"input\":\"authored\"}",
      "specs/issues/FIX-123/poc/ordering/probe.mjs": "// Authored experiment, not production.",
    };
    for (const owner of ["issues/FIX-123", "issues/FIX-101", "epics/FIX-100"]) {
      for (const document of ["SPEC", "DECISIONS", "BUSINESS-RULES", "PLAN", "DOCS"]) {
        files[`specs/${owner}/${document}.md`] =
          document === "DOCS"
            ? "Update docs/architecture/example.md: explain the retained ordering contract.\n" +
              "[Proposed behavior](./SPEC.md#direction)\n"
            : "# Direction\n## Ownership\n## Compatibility\n";
      }
    }
    const result = check(files);
    expect(result.status, result.stderr).toBe(0);
  });

  it("rejects a dangling legacy citation in a retained issue's evolution record", () => {
    const result = check({
      "specs/issues/FIX-123/EVOLUTION.md": "Predecessor: [decision](spec/FIX-101/DECISIONS.md)",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("specs/issues/FIX-123/EVOLUTION.md:1");
    expect(result.stderr).toContain("spec/FIX-101/DECISIONS.md");
  });

  it("rejects a retired docs/specs citation in an epic's proposed documentation", () => {
    const result = check({
      "specs/epics/FIX-100/DOCS.md": "See [the rule](docs/specs/FIX-101.md).",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("specs/epics/FIX-100/DOCS.md:1");
    expect(result.stderr).toContain("docs/specs/FIX-101.md");
  });

  it("still rejects project spec files outside their never-merged branch", () => {
    const result = check({ "spec/_projects/streaming/SPEC.md": "# Project direction" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("spec/_projects");
  });

  it("still rejects legacy issue specs and detached POCs", () => {
    const result = check({
      "spec/FIX-123/SPEC.md": "# Legacy direction",
      "spec-poc/ordering/probe.mjs": "// Legacy experiment",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("spec/FIX-123");
    expect(result.stderr).toContain("spec-poc/ordering");
  });
});

