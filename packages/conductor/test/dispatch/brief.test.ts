/**
 * Brief assembly and rendering — the interop surface between conductor and a
 * harness that reads prose.
 */

import { describe, expect, it } from "vitest";
import { briefFor, renderBrief } from "../../src/dispatch/brief";
import { issue } from "../fixtures";

describe("briefFor", () => {
  it("takes who and where from the entity and what and why from the action", () => {
    const brief = briefFor(
      issue("IMPLEMENTATION"),
      { kind: "addressFeedback", entityId: "FIX-1", because: "CI failed." },
      { dispatchId: "d1", branch: "fix/FIX-1", workspacePath: "/w" },
    );
    expect(brief).toEqual({
      dispatchId: "d1",
      entityId: "FIX-1",
      entityKind: "issue",
      phase: "IMPLEMENTATION",
      action: "addressFeedback",
      branch: "fix/FIX-1",
      workspacePath: "/w",
      guidancePaths: [],
      because: "CI failed.",
      summary: null,
    });
  });

  it("nulls the reason a phase-entry dispatch has none of, rather than inventing one", () => {
    const brief = briefFor(
      issue("SPEC"),
      { kind: "draftSpec", entityId: "FIX-1" },
      { dispatchId: "d1", branch: "spec/FIX-1", workspacePath: "/w" },
    );
    expect(brief.because).toBeNull();
  });
});

describe("renderBrief", () => {
  const base = briefFor(
    issue("IMPLEMENTATION"),
    { kind: "implement", entityId: "FIX-1", because: "The spec was approved." },
    {
      dispatchId: "d1",
      branch: "fix/FIX-1",
      workspacePath: "/w",
      guidancePaths: ["AGENTS.md", "docs/philosophy.md"],
      summary: "Make the board show costs.",
    },
  );

  it("states the work, the branch, the reason and the reading list", () => {
    const rendered = renderBrief(base);
    expect(rendered).toContain("Implement this work item");
    expect(rendered).toContain("`fix/FIX-1`");
    expect(rendered).toContain("The spec was approved.");
    expect(rendered).toContain("`AGENTS.md`");
    expect(rendered).toContain("Make the board show costs.");
  });

  it("tells a harness not to report back what it produced — GitHub is the authority on that", () => {
    expect(renderBrief(base)).toContain("Conductor reads GitHub for what");
  });

  it("tells a remote harness to do its work on the branch, since it has no checkout waiting", () => {
    expect(renderBrief({ ...base, workspacePath: null })).toContain("do your work on it");
  });

  it("omits the sections it has nothing for", () => {
    const bare = renderBrief({
      ...base,
      because: null,
      summary: null,
      guidancePaths: [],
    });
    expect(bare).not.toContain("Why now");
    expect(bare).not.toContain("Read before you start");
    expect(bare).not.toContain("The work item");
  });
});
