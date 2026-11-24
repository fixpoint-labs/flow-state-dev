/**
 * A coding run's report, read back out of its answer, so a review card can
 * draw each check as a check and each note as a note. The brief asks for the
 * headings (`codingBrief`); this reads what a run wrote under them, and leaves
 * an answer that didn't follow them to be shown whole.
 */
import { describe, expect, it } from "vitest";
import { codingBrief } from "../src/coding-brief";
import { RUN_REPORT_ASK, runReport } from "../src/run-report";

const REPORT = [
  "I added the day dividers.",
  "",
  "## What changed",
  "Adds day dividers to both conversations.",
  "",
  "- **Logic**: a small pure helper,",
  "  `src/lib/days.ts`.",
  "",
  "## Checks",
  "- passed: `pnpm typecheck` — no errors",
  "- **Failed**: vitest labs/teammates — 2 failing",
  "- pre-existing: vitest packages/shift-manager — 21 failures, same without the change",
  "- not done: visual check — no browser here",
  "- ran the linter",
  "",
  "## Worth knowing",
  "- days.ts is duplicated in both apps.",
  "- Codex is signed out on this machine.",
].join("\n");

describe("runReport", () => {
  it("reads What changed, each check with how it ended, and each note", () => {
    const report = runReport(REPORT)!;
    expect(report.changed).toBe("Adds day dividers to both conversations.\n\n- **Logic**: a small pure helper,\n  `src/lib/days.ts`.");
    expect(report.checks).toEqual([
      { status: "passed", text: "`pnpm typecheck` — no errors" },
      { status: "failed", text: "vitest labs/teammates — 2 failing" },
      { status: "pre-existing", text: "vitest packages/shift-manager — 21 failures, same without the change" },
      { status: "not done", text: "visual check — no browser here" },
      // A line without a status is still a check; the card can't say how it ended.
      { status: null, text: "ran the linter" },
    ]);
    expect(report.notes).toEqual(["days.ts is duplicated in both apps.", "Codex is signed out on this machine."]);
  });

  it("leaves an answer with none of the headings to be shown whole", () => {
    expect(runReport("Fixed the typo in README.md, line 1.")).toBeNull();
    expect(runReport(null)).toBeNull();
    // A heading inside a code block is code, not a section.
    expect(runReport("```md\n## Checks\n- passed: x\n```")).toBeNull();
  });

  it("takes the prose before the first heading as What changed when that section is missing", () => {
    const report = runReport("Renamed the flag.\n\n## Checks\n- passed: pnpm test")!;
    expect(report.changed).toBe("Renamed the flag.");
    expect(report.checks).toEqual([{ status: "passed", text: "pnpm test" }]);
    expect(report.notes).toEqual([]);
  });

  it("keeps a sub-heading inside What changed, and stops a section at a heading it doesn't know", () => {
    const report = runReport("## What changed\nTwo parts.\n### Server\nA route.\n## Checks\n- passed: tests\n## Something else\n- not a check")!;
    expect(report.changed).toBe("Two parts.\n### Server\nA route.");
    expect(report.checks).toEqual([{ status: "passed", text: "tests" }]);
  });

  it("reads the headings the brief asks for, so the two can't drift apart", () => {
    const brief = codingBrief(
      { epic: "board", issue: "t1", phase: "code", trackerIssue: null, attempt: 1, workspacePath: "/w", branch: "b", ctx: {}, task: { title: "t", goal: "g" }, answers: [] } as never,
      {},
    );
    expect(brief).toContain(RUN_REPORT_ASK);
    const headings = [...RUN_REPORT_ASK.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    const written = headings.map((h) => `## ${h}\n- passed: x`).join("\n");
    const report = runReport(written)!;
    expect(report.checks).toEqual([{ status: "passed", text: "x" }]);
    expect(report.notes).toEqual(["passed: x"]);
  });
});
