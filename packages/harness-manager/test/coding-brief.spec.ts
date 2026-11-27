/**
 * `codingBrief`: the one brief a coding run starts from, whatever app hands
 * it the task. The task leads, so where the app's parts disagree with it the
 * task wins; then the app's parts (the worker's instructions, a standing
 * brief, conventions); then where and how to work, what the run was answered,
 * the report it owes, and why the last attempt stopped.
 *
 * Every harness reads the same words, because the brief is the task prompt
 * and not a harness's system prompt.
 */
import { describe, expect, it } from "vitest";
import { codingBrief, type PromptRunContext } from "../src";

const run = {
  epic: "board",
  issue: "row-1",
  phase: "code",
  trackerIssue: null,
  attempt: 2,
  workspacePath: "/work/row-1",
  branch: "fsd/row-1",
  ctx: {},
  task: { title: "Add a greeting", goal: "Add a line that says hi to README.md.", context: "CONTEXT-TOKEN: the README is in the root." },
  answers: [],
  askMarkerPath: "/work/row-1/.fsdev/ask/q.md",
} as unknown as PromptRunContext;

describe("a coding run's brief", () => {
  it("leads with the task, then the worker's instructions, then where and how to work", () => {
    const brief = codingBrief(run, { instructions: "INSTRUCTIONS-TOKEN: leave a haiku in the commit." });
    const at = (text: string) => brief.indexOf(text);
    expect(at("Add a greeting")).toBeGreaterThanOrEqual(0);
    expect(at("Add a line that says hi")).toBeGreaterThan(at("Add a greeting"));
    expect(at("CONTEXT-TOKEN")).toBeGreaterThan(at("Add a line that says hi"));
    expect(at("INSTRUCTIONS-TOKEN")).toBeGreaterThan(at("CONTEXT-TOKEN"));
    expect(at("# Where and how to work")).toBeGreaterThan(at("INSTRUCTIONS-TOKEN"));
    expect(brief).toContain("Work in /work/row-1, on branch fsd/row-1.");
    expect(brief).toContain("attempt 2");
    expect(codingBrief({ ...run, branch: "" } as PromptRunContext, {})).toContain("Work in /work/row-1.\n");
  });

  it("asks for a report that names what changed, what was checked and what could not be, under the headings the review reads", () => {
    const brief = codingBrief(run, {});
    const report = brief.slice(brief.indexOf("# Your report"));
    expect(report).toContain("## What changed");
    expect(report).toContain("## Checks");
    expect(report).toContain("## Worth knowing");
    expect(report).toMatch(/each command you ran with its result/);
    expect(report).toMatch(/each check you could not do and why/);
    expect(report).toMatch(/`not done:`/);
  });

  it("leaves the report out for a run whose last message is the answer a person reads", () => {
    const brief = codingBrief(run, { report: false, terms: ["Answer in your last message."] });
    expect(brief).not.toContain("# Your report");
    expect(brief).not.toMatch(/each command you ran/);
  });

  it("points at the repository's conventions unless the app hands its own", () => {
    expect(codingBrief(run, {})).toMatch(/AGENTS\.md or CLAUDE\.md/);
    const own = codingBrief(run, { conventions: "CONVENTIONS-TOKEN" });
    expect(own).toContain("CONVENTIONS-TOKEN");
    expect(own).not.toMatch(/AGENTS\.md or CLAUDE\.md/);
  });

  it("carries a standing brief under its name", () => {
    expect(codingBrief(run, { standingBrief: { name: "team-brief", text: "BRIEF-TOKEN" } })).toContain(
      "# Your team's standing brief (team-brief)\n\nBRIEF-TOKEN",
    );
  });

  it("carries the app's own terms under where and how to work", () => {
    const brief = codingBrief(run, { terms: ["TERMS-TOKEN: commit your work."] });
    expect(brief.indexOf("TERMS-TOKEN")).toBeGreaterThan(brief.indexOf("# Where and how to work"));
  });

  it("carries what the run was answered, and why the last attempt stopped", () => {
    const brief = codingBrief(
      { ...run, answers: [{ question: "Tabs or spaces?", answer: "Spaces." }], feedback: "`node check.mjs` exited 3." } as PromptRunContext,
      {},
    );
    expect(brief).toContain("You asked: Tabs or spaces?\nThey answered: Spaces.");
    expect(brief).toContain("# Why the last attempt stopped\n\n`node check.mjs` exited 3.");
    expect(codingBrief(run, {})).not.toContain("# Why the last attempt stopped");
    expect(codingBrief(run, {})).not.toContain("# Answers to your questions");
  });

  it("names the issue a minted row is for, and caps what its dependencies produced", () => {
    const brief = codingBrief(
      {
        ...run,
        trackerIssue: "ENG-142",
        task: { ...run.task, deps: { big: "x".repeat(10_000) } },
      } as PromptRunContext,
      {},
    );
    expect(brief).toContain("Issue ENG-142.");
    expect(brief).toMatch(/\[truncated: \d+ more characters\]/);
  });
});
