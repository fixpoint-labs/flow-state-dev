/**
 * The retired-terms guard (`scripts/check-retired-terms.mjs`) over fixture
 * trees: what it must refuse, what it must leave alone, and the two holes it
 * closes that a word list can't (a folder nobody classified, an exception
 * nobody needs).
 */
import { describe, expect, it } from "vitest";
import {
  EXCEPTIONS,
  GLOSSARY_TERMS,
  PERSON_PINS,
  PLANTS,
  STALE_PLANT,
  census,
  checkGlossary,
  control,
  parseUnifiedAddedLines,
  scanCollectionRows,
  // @ts-expect-error — root check script, plain .mjs with no type declarations.
} from "../../../scripts/check-retired-terms.mjs";
// @ts-expect-error — vocabulary rule module, plain .mjs with no type declarations.
import { COLLECTION_ITEM, RETIRED } from "../../../goals/vocabulary/one-word-per-thing/rules.mjs";

type Hit = { path: string; area: string; term: string; line: number; text: string };
type Tree = { files: Map<string, string>; paths: string[] };
type Census = {
  hits: Hit[];
  unscoped: string[];
  stale: string[];
  glossary: { missing: string[]; repeated: string[] };
  ok: boolean;
};

const GLOSSARY = "apps/docs/docs/glossary.md";

/** A glossary with one row per shipped term, in its Workforce section. */
const glossaryText = (extraRows: string[] = []): string =>
  [
    "# Glossary",
    "",
    "## Workforce: workers, coordinators, projects",
    "",
    "| Term | Package | What it is | Built from |",
    "|---|---|---|---|",
    ...(GLOSSARY_TERMS as string[]).map((t) => `| **${t}** | workforce | Defined once. | None |`),
    ...extraRows,
    "",
  ].join("\n");

const tree = (files: Record<string, string>): Tree => ({
  files: new Map(Object.entries({ [GLOSSARY]: glossaryText(), ...files })),
  paths: [GLOSSARY, ...Object.keys(files)],
});

const run = (files: Record<string, string>, extraExceptions: object[] = []): Census =>
  (census as (t: Tree, o: { extraExceptions: object[] }) => Census)(tree(files), { extraExceptions });

const counted = (r: Census): string[] => r.hits.map((h) => `${h.path}:${h.line}:${h.term}`);

describe("the guard refuses a retired word wherever it isn't kept on purpose", () => {
  it("refuses every planted line, the stale exception, the duplicate row and the unscoped folder", () => {
    // The CLI's --control runs this over the real tree; here it runs over a
    // fixture, so a plant that only passes because of the real tree's contents
    // would show up as slipping through.
    const fixture = tree({ [PERSON_PINS[0].path]: "Say how to reach a person when you can't help.\n" });
    const { results, ok } = (control as (t: Tree) => { results: Array<{ what: string; refused: boolean }>; ok: boolean })(fixture);
    expect(results.filter((x) => !x.refused)).toEqual([]);
    expect(ok).toBe(true);
    // One result per plant with a term, plus the duplicate row, the stale
    // exception and the unscoped folder.
    expect(results).toHaveLength((PLANTS as Array<{ term: string | null }>).filter((p) => p.term !== null).length + 3);
  });

  it("counts a task board's own seat: seat has no exception, the board's included", () => {
    const r = run({
      "packages/orchestration/src/task-board/zz.ts": "// the default seat runs every task\n",
      "packages/orchestration/src/task-board/zz-type.ts": "export type TaskSeat = string;\n",
      "apps/kitchen-sink/flows/zz/flow.ts": "if (envelope.seat === name) return;\n",
    });
    expect(counted(r)).toEqual([
      "packages/orchestration/src/task-board/zz.ts:1:seat",
      "packages/orchestration/src/task-board/zz-type.ts:1:seat",
      "apps/kitchen-sink/flows/zz/flow.ts:1:seat",
    ]);
  });

  it("matches seat on word parts, so leaseAtClaim and closeAt are not seats", () => {
    const r = run({ "packages/orchestration/src/zz.ts": "const leaseAtClaim = closeAt(1);\n" });
    expect(r.hits).toEqual([]);
  });

  it("counts a retired word in an in-scope path, since a renamed file's text can be silent", () => {
    const r = run({ "packages/workforce/src/mailbox/entry.ts": "export const entry = 1;\n" });
    expect(counted(r)).toEqual(["packages/workforce/src/mailbox/entry.ts:0:mailbox"]);
  });

  it("counts a goal's name, so a goal named for a seat cannot be cited", () => {
    // The goal's own folder is kept (goals keep their words); citing it from a page or a package is not.
    const r = run({
      "goals/workforce-seats/x/goal.md": "# x\n", // retired-name-refusal: a planted goal name
      "packages/workforce/src/zz.ts": "// see goals/workforce-seats/x/ for the worker\n", // retired-name-refusal
    });
    expect(counted(r)).toEqual(["packages/workforce/src/zz.ts:1:seat"]);
  });

  it("strips a pinned non-user person and counts any other person on the line", () => {
    const pin = PERSON_PINS[0] as { path: string };
    const kept = run({ [pin.path]: "If you can't help, say how to reach a person.\n" });
    expect(kept.hits).toEqual([]);
    const r = run({ [pin.path]: "If you can't help, say how to reach a person, and tell the person who signed in.\n" });
    expect(counted(r)).toEqual([`${pin.path}:1:person`]);
  });
});

describe("words with live meanings elsewhere count on Workforce's ground only", () => {
  it("counts member and kind in Workforce, and leaves the engine's kind and a project's members alone", () => {
    const r = run({
      "packages/workforce/src/zz.ts": [
        "// wake each member of the coordinator", // counted: a member that means a delegate
        "// the worker's kind decides its tools", // counted: the flow a worker runs on
        "const flowKind = def.kind; // the engine's own field",
        "// only project members open a workstream",
      ].join("\n"),
      "packages/core/src/zz.ts": "// each member of the union has a kind\n",
    });
    expect(counted(r)).toEqual(["packages/workforce/src/zz.ts:1:member", "packages/workforce/src/zz.ts:2:kind"]);
  });

  it("puts a file that imports Workforce on its ground, wherever it sits", () => {
    const r = run({
      "apps/kitchen-sink/components/zz-pane.tsx": [
        'import { openRoster } from "@flow-state-dev/workforce";',
        "// the pane shows the worker's kind",
      ].join("\n"),
      "apps/kitchen-sink/components/zz-other.tsx": "// the pane shows the worker's kind\n",
    });
    expect(counted(r)).toEqual(["apps/kitchen-sink/components/zz-pane.tsx:2:kind"]);
  });
});

describe("totality: every file has an area, every exception earns its place", () => {
  it("passes a fixture with nothing retired in it", () => {
    const r = run({ "packages/workforce/src/zz.ts": "// a coordinator hands each post to a delegate\n" });
    expect(r.hits).toEqual([]);
    expect(r.unscoped).toEqual([]);
    expect(r.glossary).toEqual({ missing: [], repeated: [] });
  });

  it("names a folder no area classifies", () => {
    expect(run({ "zz-new-folder/notes.md": "Nothing retired.\n" }).unscoped).toEqual(["zz-new-folder/notes.md"]);
  });

  it("reports an exception that strips nothing", () => {
    const r = run({ "packages/workforce/src/zz.ts": "// nothing to strip\n" }, [STALE_PLANT]);
    expect(r.stale).toContain((STALE_PLANT as { id: string }).id);
    expect(r.ok).toBe(false);
  });

  it("lets every exception strip only the terms it names", () => {
    // An exception that could strip any term would hide a second word on its line.
    for (const e of EXCEPTIONS as Array<{ id: string; terms: string[] }>) expect(e.terms.length, e.id).toBeGreaterThan(0);
    expect((EXCEPTIONS as Array<{ terms: string[] }>).some((e) => e.terms.includes("seat"))).toBe(false);
  });
});

describe("the glossary defines each shipped term exactly once", () => {
  const check = checkGlossary as (text: string) => { missing: string[]; repeated: string[] };

  it("accepts one row per term", () => {
    expect(check(glossaryText())).toEqual({ missing: [], repeated: [] });
  });

  it("names a term with two rows, and a term with none", () => {
    const text = glossaryText(["| **Worker** | workforce | A second definition. | None |"]).replace(/^\| \*\*Door\*\*.*$/m, "");
    expect(check(text)).toEqual({ missing: ["Door"], repeated: ["Worker"] });
  });

  it("doesn't count Shift Manager's screen rows toward a term", () => {
    expect(check(glossaryText(["| **Roster** | Shift Manager | A screen. | Roster |"]))).toEqual({ missing: [], repeated: [] });
  });
});

const collectionHits = (path: string, text: string, added?: number[]): string[] => {
  const lines = added ?? text.split("\n").map((_, i) => i + 1);
  return (scanCollectionRows as (path: string, text: string, added: Set<number>) => Hit[])(path, text, new Set(lines)).map(
    (h) => `${h.line}:${h.text}`,
  );
};

describe("stored collection data added on this change is an item, not a row", () => {
  const collectionFile = "packages/orchestration/src/tasks/collection/zz.ts";

  it("keeps the rule out of the whole-tree sweep", () => {
    // The sweep fails on every match. Collection rows already fill the tree, so this rule
    // stays off that list and the added-line check is what enforces it.
    expect((RETIRED as Array<{ id: string }>).map((r) => r.id)).not.toContain((COLLECTION_ITEM as { id: string }).id);
    expect((COLLECTION_ITEM as { scope: string; say: string }).scope).toBe("added-lines");
    expect((COLLECTION_ITEM as { say: string }).say).toBe("collection item");
  });

  it("counts a new collection Row type and docs prose, and leaves what is already there", () => {
    expect(collectionHits(collectionFile, "export type WidgetRow = { id: string };\n")).toEqual([
      "1:export type WidgetRow = { id: string };",
    ]);
    expect(collectionHits(collectionFile, "export interface WidgetRow { id: string }\n")).toEqual([
      "1:export interface WidgetRow { id: string }",
    ]);
    // The declaration is on line 2. Line 1 is the existing name, and it is not part of the change.
    expect(collectionHits(collectionFile, "export type OldRow = { id: string };\nexport type WidgetRow = { id: string };\n", [2])).toEqual([
      "2:export type WidgetRow = { id: string };",
    ]);
    expect(
      collectionHits("apps/docs/docs/resources/overview.md", "Each collection row stores the topic.\nRead the row of the collection.\nA collection's row keeps its topic.\n"),
    ).toEqual([
      "1:Each collection row stores the topic.",
      "2:Read the row of the collection.",
      "3:A collection's row keeps its topic.",
    ]);
  });

  it("counts a Row type whose name or line says collection, wherever the file sits", () => {
    expect(collectionHits("packages/engine/src/zz.ts", "export interface CollectionRow { id: string }\n")).toEqual([
      "1:export interface CollectionRow { id: string }",
    ]);
    expect(collectionHits("packages/engine/src/zz.ts", "export type WidgetRow = { id: string }; // one collection item\n")).toEqual([
      "1:export type WidgetRow = { id: string }; // one collection item",
    ]);
  });

  it("leaves response items, record, entry, a non-collection Row type, and UI table rows alone", () => {
    const untouched = [
      "export type OutputItem = { type: string };",
      "function getItems() { return []; }",
      "recordHarnessUsage();",
      "export type CollectionSnapshotEntry = { topic: string };",
      "type TraceRow = { type: string };",
      "type Row = readonly [label: string, expected: string];",
    ].join("\n");
    expect(collectionHits("packages/engine/src/zz.ts", untouched)).toEqual([]);
    expect(collectionHits("apps/docs/docs/resources/overview.md", "response.getItems() returns an OutputItem.\nrecordHarnessUsage writes a run record.\n")).toEqual([]);
    expect(collectionHits("apps/docs/docs/resources/overview.md", "Each table row is a grid row.\n<tr><td>n</td></tr>\n")).toEqual([]);
    // Same collection file, but the names and the line are a rendered table.
    expect(collectionHits(collectionFile, "export type BoardCardRow = { id: string };\nexport type TableRow = { id: string };\nexport type DataTableRow = { id: string };\n")).toEqual([]);
    expect(collectionHits("packages/react/src/components/panels/BoardColumns.tsx", "export type WidgetRow = { id: string };\n")).toEqual([]);
    expect(collectionHits("packages/react/src/components/flow-navigator/rows.tsx", "export type SessionRow = { id: string };\n")).toEqual([]);
  });

  it("does not read the guard's own lines, which name the pattern on purpose", () => {
    const guard = "packages/core/test/retired-terms-check.test.ts";
    expect(collectionHits(guard, "export type WidgetRow = { id: string };\nEach collection row is stored.\n")).toEqual([]);
    expect(collectionHits("scripts/check-retired-terms.mjs", "Each collection row is stored beside the worker.\n")).toEqual([]);
    expect(collectionHits("goals/vocabulary/one-word-per-thing/rules.mjs", "Each collection row is stored.\n")).toEqual([]);
  });
});

describe("added lines come from the diff, not from the lines around them", () => {
  const parse = parseUnifiedAddedLines as (diff: string) => Map<string, Set<number>>;

  it("counts a new file's lines and an inserted line, and skips a deletion", () => {
    const diff = [
      "diff --git a/packages/orchestration/src/tasks/collection/widget.ts b/packages/orchestration/src/tasks/collection/widget.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/packages/orchestration/src/tasks/collection/widget.ts",
      "@@ -0,0 +1,2 @@",
      "+export type WidgetRow = { id: string };",
      "+const id = 1;",
      "diff --git a/packages/engine/src/zz.ts b/packages/engine/src/zz.ts",
      "--- a/packages/engine/src/zz.ts",
      "+++ b/packages/engine/src/zz.ts",
      "@@ -4,0 +5 @@",
      "+export type WidgetRow = { id: string };",
      "@@ -9 +10 @@",
      "-const old = 1;",
      "+const next = 2;",
      "@@ -12 +12,0 @@",
      "-const gone = 1;",
    ].join("\n");
    const added = parse(diff);
    expect([...(added.get("packages/orchestration/src/tasks/collection/widget.ts") ?? [])]).toEqual([1, 2]);
    expect([...(added.get("packages/engine/src/zz.ts") ?? [])].sort((a, b) => a - b)).toEqual([5, 10]);
  });

  it("counts an added line whose text starts with ++", () => {
    const diff = ["diff --git a/p.ts b/p.ts", "--- a/p.ts", "+++ b/p.ts", "@@ -1 +1,2 @@", " kept", "+++ still added"].join("\n");
    expect([...(parse(diff).get("p.ts") ?? [])]).toEqual([2]);
  });
});
