import { describe, expect, it } from "vitest";
// @ts-expect-error — root check script, plain .mjs with no type declarations.
import { findOffenders, issueIdsFromPr } from "../../../scripts/validate-changeset-refs.mjs";

type PrId = { id: string; from: "branch" | "title" };
type Fragment = { status: "A" | "M"; path: string; source: string };
type Offender = { path: string; reason: string };

const prIds = (pr: { branch?: string; title?: string }): PrId[] =>
  (issueIdsFromPr as (pr: { branch?: string; title?: string }) => PrId[])(pr);

const check = (fragments: Fragment[], ids: PrId[]): Offender[] =>
  (findOffenders as (f: Fragment[], i: PrId[]) => Offender[])(fragments, ids);

const fragment = (body: string, status: "A" | "M" = "A", path = ".changeset/x.md"): Fragment => ({
  status,
  path,
  source: `---\n"@flow-state-dev/core": patch\n---\n\n${body}\n`,
});

/**
 * The guard exists because a well-formed but wrong id once passed green
 * (#1391: a FIX-1215 change whose fragment cited FIX-1209) and only reviewers
 * caught it. These are that PR's real inputs: the branch named no issue, the
 * title named FIX-1215, and the description named FIX-1209 four times — which
 * is why the description is never a source.
 */
const PR_1391 = {
  branch: "change/drop-scope-clientdata-shim",
  title: "refactor(core)!: remove the scope-config clientData compatibility shim (FIX-1215)",
};

describe("a new fragment must cite this PR's own issue", () => {
  it("fails #1391's wrong id, naming the cited id and the PR's id", () => {
    const offenders = check(
      [fragment("Scope configs reject `clientData` (FIX-1209).")],
      prIds(PR_1391),
    );
    expect(offenders).toHaveLength(1);
    expect(offenders[0].reason).toContain("FIX-1209");
    expect(offenders[0].reason).toContain("FIX-1215");
    expect(offenders[0].reason).toContain("title");
  });

  it("passes when a cited id is the PR's issue", () => {
    expect(check([fragment("Scope configs reject `clientData` (FIX-1215).")], prIds(PR_1391))).toEqual([]);
  });

  it("needs only one match, so a sub-issue cited with its parent passes", () => {
    const ids = prIds({ branch: "fix-1719-pr3-codex-followups" });
    expect(check([fragment("Boot replaces the row (FIX-1621, part of FIX-1719).")], ids)).toEqual([]);
  });

  it("reports only the fragment that does not match", () => {
    const ids = prIds({ branch: "fix/FIX-1021" });
    const offenders = check(
      [
        fragment("Request ids are bound to their owner (FIX-1021).", "A", ".changeset/ok.md"),
        fragment("Session ids read as not found (FIX-1022).", "A", ".changeset/bad.md"),
      ],
      ids,
    );
    expect(offenders.map((o) => o.path)).toEqual([".changeset/bad.md"]);
  });

  it("skips the match when the branch and title name no issue, but still requires an id", () => {
    const ids = prIds({ branch: "claude/project-thread-8ra0ke", title: "fix(engine): a thing" });
    expect(ids).toEqual([]);
    expect(check([fragment("A thing (FIX-1083).")], ids)).toEqual([]);
    expect(check([fragment("A thing.")], ids)).toEqual([
      { path: ".changeset/x.md", reason: "no Linear issue id in the body" },
    ]);
  });

  it("skips an empty fragment, which releases nothing", () => {
    const empty: Fragment = { status: "A", path: ".changeset/empty.md", source: "---\n---\n" };
    expect(check([empty], prIds(PR_1391))).toEqual([]);
  });

  it("passes a PR that adds no fragment", () => {
    expect(check([], prIds(PR_1391))).toEqual([]);
  });
});

describe("an edited fragment keeps the presence check only", () => {
  it("passes an edited fragment that cites another issue", () => {
    expect(check([fragment("Someone else's note (FIX-900).", "M")], prIds(PR_1391))).toEqual([]);
  });

  it("fails an edited fragment left with no id", () => {
    expect(check([fragment("Someone else's note.", "M")], prIds(PR_1391))).toEqual([
      { path: ".changeset/x.md", reason: "no Linear issue id in the body" },
    ]);
  });

  it("fails a new fragment with no id", () => {
    expect(check([fragment("A note.")], prIds(PR_1391))).toEqual([
      { path: ".changeset/x.md", reason: "no Linear issue id in the body" },
    ]);
  });

  it("fails a fragment with no frontmatter", () => {
    const bare: Fragment = { status: "A", path: ".changeset/x.md", source: "FIX-1215 only" };
    expect(check([bare], prIds(PR_1391))).toEqual([
      { path: ".changeset/x.md", reason: "no changeset frontmatter" },
    ]);
  });
});

describe("reading this PR's issue ids", () => {
  it("reads lower-case and upper-case branch ids", () => {
    expect(prIds({ branch: "claude/fix-1532-thing" })).toEqual([{ id: "FIX-1532", from: "branch" }]);
    expect(prIds({ branch: "spec/FIX-1532" })).toEqual([{ id: "FIX-1532", from: "branch" }]);
  });

  it("ignores a random branch suffix that only looks like an id", () => {
    expect(prIds({ branch: "claude/project-thread-8ra0ke" })).toEqual([]);
    expect(prIds({ branch: "cursor/define-channel-flow-7f2a" })).toEqual([]);
  });

  it("reads every id in the title", () => {
    expect(prIds({ title: "fix(core): thing (FIX-1, FIX-2)" })).toEqual([
      { id: "FIX-1", from: "title" },
      { id: "FIX-2", from: "title" },
    ]);
  });

  it("strips a sub-PR letter, so the bare parent matches", () => {
    expect(prIds({ branch: "feat/lab-138a-slice" })).toEqual([{ id: "LAB-138", from: "branch" }]);
    expect(prIds({ title: "feat: slice (LAB-138a)" })).toEqual([{ id: "LAB-138", from: "title" }]);
    expect(check([fragment("A slice (LAB-138).")], prIds({ title: "feat: slice (LAB-138a)" }))).toEqual([]);
  });

  it("lists an id named in both branch and title once", () => {
    expect(prIds({ branch: "fix/FIX-1532-x", title: "fix: x (FIX-1532)" })).toEqual([
      { id: "FIX-1532", from: "branch" },
    ]);
  });

  it("works from the branch alone when there is no title (a local run)", () => {
    expect(prIds({ branch: "fix/FIX-1532-x" })).toEqual([{ id: "FIX-1532", from: "branch" }]);
  });
});

describe("a suffixed id in a fragment is explained, not accepted", () => {
  it("names the suffixed token and the bare parent id to cite instead", () => {
    expect(check([fragment("A slice (LAB-138a).")], [])).toEqual([
      { path: ".changeset/x.md", reason: 'found "LAB-138a"; cite the bare parent id "LAB-138"' },
    ]);
  });

  it("passes a fragment that cites the suffixed id and the bare parent", () => {
    expect(check([fragment("A slice (LAB-138a of LAB-138).")], prIds({ branch: "lab-138a" }))).toEqual([]);
  });
});
