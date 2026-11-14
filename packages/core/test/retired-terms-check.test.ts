/**
 * The retired-terms guard (`scripts/check-retired-terms.mjs`) over fixture
 * trees: what it must refuse, what it must leave alone, and the two holes it
 * closes that a word list can't (a folder nobody classified, an exception
 * nobody needs).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADDED_PLANTS,
  EXCEPTIONS,
  NAME_READS,
  addedRowNames,
  addedSince,
  declaredNames,
  GLOSSARY_TERMS,
  PERSON_PINS,
  PLANTS,
  STALE_PLANT,
  census,
  checkGlossary,
  control,
  scanTreeRules,
  // @ts-expect-error — root check script, plain .mjs with no type declarations.
} from "../../../scripts/check-retired-terms.mjs";
// @ts-expect-error — the vocabulary glossary, plain .mjs with no type declarations.
import { SWEEP_RULES, TREE_EXEMPTIONS, TREE_RULES } from "../../../docs/contributing/glossary.mjs";

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
    // exception and the unscoped folder, then one per added-names plant and
    // one per parser read (each must have a plant).
    expect(results).toHaveLength(
      (PLANTS as Array<{ term: string | null }>).filter((p) => p.term !== null).length + 3 + (ADDED_PLANTS as unknown[]).length + (NAME_READS as unknown[]).length,
    );
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

describe("contributor docs and skills are read for retired names, not English meanings", () => {
  // A skill author writing plain English shouldn't fight CI; a retired name in a skill misleads an agent.
  it("counts a retired name in a skill and a contributor doc, and leaves the English 'room' alone there", () => {
    const r = run({
      ".agents/skills/zz/SKILL.md": "Each seat runs on its own branch.\nKeep the room tidy.\n",
      "docs/contributing/zz.md": "Locality is decided by `isInProcessDispatcher`.\n", // retired-name-refusal: a planted name
    });
    expect(counted(r)).toEqual([".agents/skills/zz/SKILL.md:1:seat", "docs/contributing/zz.md:1:isInProcessDispatcher"]); // retired-name-refusal: the planted name
  });

  it("still counts the meaning in code, where the same line is refused", () => {
    const r = run({ "packages/workforce/src/zz.ts": "// Keep the room tidy.\n" });
    expect(counted(r)).toEqual(["packages/workforce/src/zz.ts:1:room"]);
  });

  // A name rule keeps its encoding in the contributor trees: a code rule reads their scripts, a page
  // rule their markdown. If the two swapped, a retired symbol in a skill's prose would be refused as code.
  const PATHS = [
    ".agents/workflows/zz.js",
    ".agents/skills/zz/SKILL.md",
    "CLAUDE.md",
    "docs/contributing/zz.md",
    "labs/zz/NOTES.md",
    "labs/zz/src/zz.ts",
  ];
  const reads = (id: string): string[] => {
    const rule = (SWEEP_RULES as { id: string; files: RegExp }[]).find((r) => r.id === id);
    if (rule === undefined) throw new Error(`no sweep rule ${id}`);
    return PATHS.filter((p) => rule.files.test(p));
  };

  it("reads a code name rule in the contributor trees' scripts, not their markdown", () => {
    expect(reads("ask-symbol")).toEqual([".agents/workflows/zz.js", "labs/zz/src/zz.ts"]);
  });

  it("reads a page name rule in the contributor trees' markdown, not their scripts", () => {
    expect(reads("ask-symbol-in-docs")).toEqual([
      ".agents/skills/zz/SKILL.md",
      "CLAUDE.md",
      "docs/contributing/zz.md",
      "labs/zz/NOTES.md",
    ]);
  });

  it("keeps a meaning rule out of the contributor trees", () => {
    expect(reads("ask-prose")).toEqual(["labs/zz/src/zz.ts"]);
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

const resourceHits = (path: string, text: string): string[] =>
  (scanTreeRules as (path: string, text: string) => Hit[])(path, text).map((h) => `${h.line}:${h.text}`);

// FIX-2479 D4.
/** The three released messages a published page may still quote. */
const OWNER_PRIVATE = "A row of an owner-private collection is readable only by the user it belongs to.";
const OWNER_WRITES = "A row of an owner-writes collection is written only by the user it belongs to.";
const OVERLAP = 'Collection pattern "[tenant]/**" can reach the rows of owner-private collection';

describe("the resource entry reads the whole tree: a stored thing is a resource, a lifecycle a Status", () => {
  const rule = (TREE_RULES as Array<{ id: string; term: string; say: string }>).find((r) => r.id === "collection-row");

  it("is the guard's whole-tree rule under the Resource entry, not a sweep rule", () => {
    expect((SWEEP_RULES as Array<{ id: string }>).map((r) => r.id)).not.toContain("collection-row");
    expect(rule?.term).toBe("Resource");
    expect(rule?.say).toMatch(/ResourceState/);
    expect(rule?.say).not.toMatch(/collection item/);
  });

  it("counts a name already in the tree, not only a line a change adds", () => {
    // Line 1 was there before any change: at whole-tree scope it counts like a new one.
    expect(resourceHits("packages/orchestration/src/tasks/collection/zz.ts", "export type OldRow = { id: string };\nconst id = 1;\n")).toEqual([
      "1:export type OldRow = { id: string };",
    ]);
  });

  it("refuses a Row type in any package, wherever the file sits and whatever it says", () => {
    // No collection in the path, the line or the name: a Row type is a store's word above the stores.
    expect(resourceHits("packages/workforce/src/zz.ts", "export type FooRow = { id: string };\n")).toEqual(["1:export type FooRow = { id: string };"]);
    expect(resourceHits("packages/engine/src/zz.ts", "interface StoredRow extends Base {\n")).toEqual(["1:interface StoredRow extends Base {"]);
    expect(resourceHits("packages/core/test/zz.test.ts", "type Row = readonly [label: string, expected: string];\n")).toEqual([
      "1:type Row = readonly [label: string, expected: string];",
    ]);
    expect(resourceHits("labs/zz/src/adapter.ts", "export interface TaskRowView<T> {\n")).toEqual(["1:export interface TaskRowView<T> {"]);
  });

  it("refuses an exported value built on Row, and leaves a local, an import and a re-export", () => {
    expect(resourceHits("packages/harness-manager/src/zz.ts", "export async function readRunRow(id: string) {}\n")).toEqual([
      "1:export async function readRunRow(id: string) {}",
    ]);
    expect(resourceHits("packages/workforce/src/zz.ts", "export const fooRowSchema = z.object({});\n")).toEqual(["1:export const fooRowSchema = z.object({});"]);
    expect(resourceHits("packages/orchestration/src/zz.ts", "export function rowTruthOf() {}\n")).toEqual(["1:export function rowTruthOf() {}"]);
    const kept = [
      "const taskRow = rows[0];",
      'import { type VersionedRow } from "@flow-state-dev/contracts";',
      'export { type ScheduleIndexRow } from "./scheduleIndex";',
      "import {\n  type ResourceStateRow,\n} from \"./state\";",
      "export function throwArrow() {}",
    ].join("\n");
    expect(resourceHits("packages/engine/src/zz.ts", kept)).toEqual([]);
  });

  it("refuses a Row name exported through an export list or an alias, and leaves a re-export of an existing name", () => {
    // Changing the export syntax must not let a retired public name through.
    expect(resourceHits("packages/workforce/src/zz.ts", "const loadWidgetRow = () => null;\nexport { loadWidgetRow };\n")).toEqual(["2:export { loadWidgetRow };"]);
    expect(resourceHits("packages/workforce/src/zz.ts", "export {\n  loadWidget,\n  type WidgetRowPage,\n};\n")).toEqual(["3:type WidgetRowPage,"]);
    expect(resourceHits("packages/workforce/src/zz.ts", 'export { loadWidget as loadWidgetRow } from "./read";\n')).toEqual([
      '1:export { loadWidget as loadWidgetRow } from "./read";',
    ]);
    // The exported name is what a consumer meets: a Row local exported under another name is fine.
    expect(resourceHits("packages/workforce/src/zz.ts", "export { widgetRow as widget };\n")).toEqual([]);
  });

  it("refuses a Row name a destructuring export binds, and leaves the names it only reads", () => {
    expect(resourceHits("packages/workforce/src/zz.ts", "export const { loadWidgetRow } = helpers;\n")).toEqual(["1:export const { loadWidgetRow } = helpers;"]);
    expect(resourceHits("packages/workforce/src/zz.ts", "export const {\n  widget: loadWidgetRow,\n} = helpers;\n")).toEqual(["2:widget: loadWidgetRow,"]);
    expect(resourceHits("packages/workforce/src/zz.ts", "export const [first, { rows: widgetRows = [] }] = pair;\n")).toEqual([
      "1:export const [first, { rows: widgetRows = [] }] = pair;",
    ]);
    // `widgetRow:` is the property read; `widget` is the name a consumer meets.
    expect(resourceHits("packages/workforce/src/zz.ts", "export const { widgetRow: widget, GET } = helpers;\n")).toEqual([]);
  });

  it("reads an export list or pattern member that a comment sits in front of", () => {
    // A commented barrel export is ordinary; the comment must not hide the name, or shift its line.
    expect(resourceHits("packages/workforce/src/zz.ts", "export {\n  // reads one, then the rest\n  loadWidgetRow,\n  other,\n};\n")).toEqual(["3:loadWidgetRow,"]);
    expect(resourceHits("packages/workforce/src/zz.ts", "export { loadWidget, /** doc, with a comma */ fooRow };\n")).toEqual([
      "1:export { loadWidget, /** doc, with a comma */ fooRow };",
    ]);
    expect(resourceHits("packages/workforce/src/zz.ts", "export const {\n  /* the list */ loadWidgetRow,\n} = helpers;\n")).toEqual(["2:/* the list */ loadWidgetRow,"]);
  });

  it("reads a long file with no export list in linear time", () => {
    // A matcher that looks behind for `export {` at every character is quadratic on exactly this.
    const long = `const markup = \`${"<div class=\"a\">x</div>\n".repeat(8000)}\`;\n`;
    const started = performance.now();
    expect(resourceHits("packages/workforce/src/zz.ts", long)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("refuses a plural Row word part followed by another word part", () => {
    expect(resourceHits("packages/workforce/src/zz.ts", "export type WidgetRowsPage = { widgets: unknown[] };\n")).toEqual([
      "1:export type WidgetRowsPage = { widgets: unknown[] };",
    ]);
    expect(resourceHits("packages/workforce/src/zz.ts", "export function loadWidgetRowsPage() {}\n")).toEqual(["1:export function loadWidgetRowsPage() {}"]);
    expect(resourceHits("packages/workforce/src/zz.ts", "export function rowsetOf() {}\nexport type Rowan = string;\n")).toEqual([]);
  });

  it("refuses any CollectionItem name in code, a use as well as a declaration, and leaves a page's prose to the release", () => {
    expect(resourceHits("packages/react/src/zz.ts", "export function useFooCollectionItem() {}\n")).toEqual(["1:export function useFooCollectionItem() {}"]);
    expect(resourceHits("apps/kitchen-sink/lib/zz.ts", "const page = await client.resources.listCollectionItems(id, ref);\n")).toEqual([
      "1:const page = await client.resources.listCollectionItems(id, ref);",
    ]);
    // A published page names the released API until /release-docs rewrites it.
    expect(resourceHits("apps/docs/guides/zz.md", "Call `resources.listCollectionItems` to page.\n")).toEqual([]);
  });

  it("refuses a lifecycle named State, on one line or several, and leaves a state shape", () => {
    expect(resourceHits("packages/react/src/zz.ts", 'export type FooState = "idle" | "playing";\n')).toEqual(['1:export type FooState = "idle" | "playing";']);
    expect(resourceHits("packages/ui/registry/components/zz.tsx", 'export type FooState =\n  /** not yet */\n  | "pending"\n  | "done";\n')).toEqual([
      "1:export type FooState =",
    ]);
    expect(resourceHits("packages/workspace/src/zz.ts", 'export const fooStateSchema = z.enum(["a", "b"]);\n')).toEqual([
      '1:export const fooStateSchema = z.enum(["a", "b"]);',
    ]);
    const shapes = [
      "export type FooState = { value: string };",
      "export type WorkerResourceState = z.infer<typeof workerResourceStateSchema>;",
      'export type RunState =\n  | { kind: "none" }',
      'export type FooStatus = "a" | "b";',
    ].join("\n");
    expect(resourceHits("packages/workforce/src/zz.ts", shapes)).toEqual([]);
  });

  it("keeps Row in a store adapter and a UI list module, by path alone", () => {
    expect(resourceHits("packages/store-sqlite/src/zz.ts", "type ResourceRow = { key: string };\n")).toEqual([]);
    expect(resourceHits("packages/engine/src/stores/zz.ts", "export type ResourceStateRow = VersionedRow<JsonObject>;\n")).toEqual([]);
    expect(resourceHits("packages/workforce/src/react/components/cards.ts", "export type BoardCardRow = { id: string };\n")).toEqual([]);
    expect(resourceHits("packages/shift-manager/src/surfaces/roster/list.tsx", "export function WorkerRow() {}\n")).toEqual([]);
    // The same names one folder over are a read model, not a rendered row.
    expect(resourceHits("packages/shift-manager/src/lib/zz.ts", "export type WorkerRow = { id: string };\n")).toEqual(["1:export type WorkerRow = { id: string };"]);
    // The path keeps Row only: a CollectionItem name and a lifecycle State still count there.
    expect(resourceHits("packages/workforce/src/react/components/zz.ts", "export type FooCollectionItem = { id: string };\n")).toHaveLength(1);
    expect(resourceHits("packages/store-sqlite/src/zz.ts", 'export type FooState = "a" | "b";\n')).toHaveLength(1);
  });

  it("counts a page calling a resource in a collection a row", () => {
    expect(
      resourceHits("apps/docs/docs/resources/overview.md", "Each collection row stores the topic.\nRead the row of the collection.\nA collection's row keeps its topic.\n"),
    ).toEqual(["1:Each collection row stores the topic.", "2:Read the row of the collection.", "3:A collection's row keeps its topic."]);
    expect(resourceHits("docs/architecture/zz.md", "Each collection row stores the topic.\n")).toHaveLength(1);
    expect(resourceHits("apps/docs/docs/resources/overview.md", "response.getItems() returns an OutputItem.\nEach table row is a grid row.\n")).toEqual([]);
  });

  it("lets a published page quote the three released messages, stripping the quote and not the line", () => {
    const page = "apps/docs/docs/resources/collections.md";
    expect(resourceHits(page, `Anyone else's write throws "${OWNER_WRITES}" and changes nothing.\n`)).toEqual([]);
    expect(resourceHits(page, `\`get\` throws "${OWNER_PRIVATE}"\n`)).toEqual([]);
    expect(resourceHits(page, `${OVERLAP}\n`)).toEqual([]);
    expect(resourceHits("packages/workforce/README.md", `  \`${OWNER_WRITES}\`, whichever flow\n`)).toEqual([]);
    // A second use on the quoting line still counts.
    expect(resourceHits(page, `It throws "${OWNER_WRITES}" for each row of the owner-writes collection.\n`)).toHaveLength(1);
    // Only published pages: a contributor doc says the new words now.
    expect(resourceHits("docs/architecture/resources-and-client-data.md", `(\`${OWNER_WRITES}\`)\n`)).toHaveLength(1);
    // Only the released text: a paraphrase is not a quote.
    expect(resourceHits(page, "It throws: a row of an owner-writes collection is written only by its user.\n")).toHaveLength(1);
  });

  it("carries no exemption beyond the store-adapter and UI-list paths and the released quotes", () => {
    const kept = (TREE_EXEMPTIONS as Array<Record<string, unknown>>).map((e) => [e.id, Object.keys(e).sort().join(",")]);
    expect(kept).toEqual([
      ["store-adapter-rows", "id,path,rules,why"],
      ["ui-list-rows", "id,path,rules,why"],
      ["released-quotes", "id,pages,quotes,rules,why"],
    ]);
  });

  it("does not read the guard's own lines, which name the pattern on purpose", () => {
    expect(resourceHits("packages/core/test/retired-terms-check.test.ts", "export type WidgetRow = { id: string };\nEach collection row is stored.\n")).toEqual([]);
    expect(resourceHits("scripts/check-retired-terms.mjs", "export type WidgetRow = { id: string };\n")).toEqual([]);
    expect(resourceHits("docs/contributing/glossary.mjs", "Each collection row is stored.\n")).toEqual([]);
  });

  it("fails the census on a hit and on a quote exemption nothing needs any more", () => {
    const hit = run({ "packages/workforce/src/zz.ts": "export type FooRow = { id: string };\n" });
    expect(hit.ok).toBe(false);
    expect(counted(hit)).toContain("packages/workforce/src/zz.ts:1:collection-row");
    // A fixture with no quote: the released-quote exemption strips nothing, so it is stale.
    expect(run({}).stale).toContain("released-quotes");
  });
});

type Added = { term: string; line: number; name: string; text: string };
const added = (path: string, before: string | null, after: string): string[] =>
  (addedRowNames as (p: string, b: string | null, a: string) => Added[])(path, before, after).map((h) => `${h.line}:${h.name}`);
type Read = { read: string };

describe("the resource entry reads Row type parameters and the six phrases on every line of the tree", () => {
  it("refuses a row type parameter anywhere, and leaves a type argument and a rendered element", () => {
    // A type parameter is a name the next reader copies, so it counts with no change to hold it.
    expect(resourceHits("packages/engine/src/zz.ts", "function g<TRow extends object>(x: TRow) {}\n")).toEqual(["1:function g<TRow extends object>(x: TRow) {}"]);
    expect(resourceHits("packages/workforce/src/zz.ts", "function h<TaskRows>() {}\n")).toHaveLength(1);
    // Passing or rendering a Row name is a use: its declaration is where it counts.
    expect(resourceHits("packages/workforce/src/zz.ts", "const page = load<TaskRow>();\n")).toEqual([]);
    expect(resourceHits("packages/workforce/src/zz.tsx", "const view = <TaskRow id={id} />;\n")).toEqual([]);
  });

  it("refuses a phrase in a comment, a test name, a string, a page and a figure", () => {
    expect(resourceHits("packages/workforce/src/zz.ts", "// the subscription row is deleted when it ends\n")).toHaveLength(1);
    expect(resourceHits("packages/orchestration/test/zz.test.ts", 'it("reads each task\'s rows", () => {});\n')).toHaveLength(1);
    expect(resourceHits("packages/workforce/src/zz.ts", 'throw new Error("no schedule row for that id");\n')).toHaveLength(1);
    expect(resourceHits("docs/contributing/zz.md", "Write the Project Row back once.\n")).toHaveLength(1);
    // A figure is read like any other text: a label on a published SVG counts.
    expect(resourceHits("apps/docs/guides/zz.svg", '<text x="1" y="1">The worker rows</text>\n')).toHaveLength(1);
    // "entry", the resource's own name, and a row that names no resource pass.
    expect(resourceHits("packages/workforce/src/zz.ts", "// the subscription entry, each task, a table row, a row in the UI\n")).toEqual([]);
  });

  it("keeps the phrases in a store adapter and a UI list module, and counts what they keep", () => {
    const kept: Record<string, number> = {};
    const scan = scanTreeRules as (p: string, t: string, k: Record<string, number>) => Hit[];
    expect(scan("packages/store-sqlite/src/zz.ts", "// the schedule row's primary key\n", kept)).toEqual([]);
    expect(scan("packages/shift-manager/src/components/zz.tsx", "// the worker's row on the roster\n", kept)).toEqual([]);
    expect(kept).toEqual({ "store-adapter-rows": 1, "ui-list-rows": 1 });
  });
});

describe("TypeScript's parser reads every declaration kind, and a use never", () => {
  const names = (text: string) =>
    (declaredNames as (p: string, t: string) => Array<{ name: string; kind: string; read: string }>)("zz.ts", text).map((d) => `${d.read}:${d.kind}:${d.name}`);

  it("tells an exported value from a local, and a binding from the key it reads", () => {
    expect(names("export const fooRow = 1; const barRow = 2;")).toEqual(["variable:exported-value:fooRow", "variable:local:barRow"]);
    expect(names("export const { taskRow: task, list: rows } = x;")).toEqual(["binding:exported-value:task", "binding:exported-value:rows"]);
    expect(names("export function readRow() {} function writeRow() {}")).toEqual(["function:exported-value:readRow", "function:local:writeRow"]);
  });

  it("reads a binding inside a function in an exported initializer as a local, not an exported value", () => {
    // The export's statement is outside the function: what the function binds is no name a consumer meets.
    expect(names("export const f = ({ row }) => row;")).toEqual(["variable:exported-value:f", "binding:local:row"]);
    // The inline type literal's members are declarations too, properties, not exported values.
    expect(names("export const ids = [].map(({ row }: { row: { id: string } }) => row.id);")).toEqual([
      "variable:exported-value:ids",
      "binding:local:row",
      "property:property:row",
      "property:property:id",
    ]);
    expect(names("export const g = (list) => {\n  return list.map(({ taskRow }) => taskRow);\n};")).toEqual(["variable:exported-value:g", "parameter:parameter:list", "binding:local:taskRow"]);
    // An object-literal method and a class method in an exported initializer: the same boundary.
    expect(names("export const o = { m({ row }) { return row; } };")).toEqual(["variable:exported-value:o", "binding:local:row"]);
    // A class's method is a declaration the class owns; what it binds is still its own.
    expect(names("export const K = class { m({ row }) { return row; } };")).toEqual(["variable:exported-value:K", "property:property:m", "binding:local:row"]);
    // And the whole-tree reach leaves them alone, while a destructuring export is still refused.
    expect(resourceHits("packages/workforce/src/zz.ts", "export const ids = [].map(({ row }: { row: { id: string } }) => row.id);\n")).toEqual([]);
    expect(resourceHits("packages/workforce/src/zz.ts", "export const { fooRow } = x;\n")).toEqual(["1:export const { fooRow } = x;"]);
  });

  it("reads a method or accessor only where a class or a type declares it, never an object literal's key", () => {
    // An object key is a use (the glossary): `{ row() {} }` is the same key as `{ row: () => {} }`.
    expect(names("const obj = { row() {} };")).toEqual(["variable:local:obj"]);
    expect(names("const obj = { get row() { return 1; }, set rowId(v) {} };")).toEqual(["variable:local:obj", "parameter:parameter:v"]);
    expect(names("const obj = { row: () => {} };")).toEqual(["variable:local:obj"]);
    expect(added("packages/workforce/src/zz.ts", null, "const obj = { row() {}, get rows() { return []; }, taskRow: () => 1 };\n")).toEqual([]);
    // In a class or an interface it is a declaration.
    expect(names("class C { row() {} get rowId() { return 1; } }\ninterface I { taskRow(): void }")).toEqual([
      "class:class:C",
      "property:property:row",
      "property:property:rowId",
      "interface:type:I",
      "property:property:taskRow",
    ]);
  });

  it("reads an import-equals, a namespace and a namespace re-export, which bind names too", () => {
    expect(names('import rowLib = require("./x");')).toEqual(["import-equals:import:rowLib"]);
    expect(names("namespace rowSpace {}\nexport namespace FooRows {}\nmodule barRow {}")).toEqual([
      "namespace:local:rowSpace",
      "namespace:exported-value:FooRows",
      "namespace:local:barRow",
    ]);
    // An ambient module named by a string is a module's path, not a name.
    expect(names('declare module "row-lib" {}')).toEqual([]);
    expect(names('export * as FooRow from "./x";')).toEqual(["namespace-export:export:FooRow"]);
    expect(resourceHits("packages/workforce/src/zz.ts", 'export * as FooRow from "./x";\n')).toEqual(['1:export * as FooRow from "./x";']);
  });

  it("reads an import only when it binds a name, and an export list only when it is not a plain re-export", () => {
    expect(names('import { VersionedRow } from "./v"; import { b as barRows } from "./x"; import rowDefault from "./d";')).toEqual([
      "import:import:barRows",
      "import:import:rowDefault",
    ]);
    expect(names('export { FooRow } from "./w"; export { a as fooRow } from "./w"; export { localRow };')).toEqual(["export-list:export:fooRow", "export-list:export:localRow"]);
  });

  it("dropping any one read lets its plant through the control", () => {
    // The control is only as good as its plants: each read must have one that nothing else catches.
    const fixture = tree({ [PERSON_PINS[0].path]: "Say how to reach a person when you can't help.\n" });
    const run = control as (t: Tree, o: { reads: Read[] }) => { results: Array<{ what: string; refused: boolean }>; ok: boolean };
    for (const dropped of NAME_READS as Read[]) {
      const { ok, results } = run(fixture, { reads: (NAME_READS as Read[]).filter((r) => r !== dropped) });
      expect(ok, `control passed with the ${dropped.read} read dropped`).toBe(false);
      expect(results.filter((x) => !x.refused).map((x) => x.what).join(" ")).toContain(dropped.read);
    }
  });
});

// FIX-2631 D1.
describe("a change may not add a retired name to a file (a per-file ratchet)", () => {
  it("refuses a new local, parameter or property, and names the one that is new", () => {
    expect(added("packages/workforce/src/zz.ts", null, "const taskRow = 1;\n")).toEqual(["1:taskRow"]);
    expect(added("packages/workforce/src/zz.ts", "const row = 1;\n", "const row = 1;\nfunction f(row: unknown) {}\n")).toEqual(["2:row"]);
    expect(added("packages/workforce/src/zz.ts", "", "interface I {\n  workerRow: string;\n}\n")).toEqual(["2:workerRow"]);
  });

  it("passes an edit to a line that already declares one, and a swap inside one file", () => {
    // A diff marks an edited line as added; counting per file is what keeps an edit from forcing a rename.
    expect(added("packages/workforce/src/zz.ts", "const row = load();\n", "const row = (load() ?? null);\n")).toEqual([]);
    expect(added("packages/workforce/src/zz.ts", "const row = 1;\n", "const taskRow = 1;\n")).toEqual([]);
    // Fewer is always fine.
    expect(added("packages/workforce/src/zz.ts", "const row = 1;\nconst rows = [];\n", "const entry = 1;\n")).toEqual([]);
  });

  it("passes a use, a kept path, and a file outside in-scope code", () => {
    expect(added("packages/workforce/src/zz.ts", null, "use(entry.row); call({ row }); const s = 'row';\n")).toEqual([]);
    expect(added("packages/store-postgres/src/zz.ts", null, "const row = 1;\n")).toEqual([]);
    expect(added("packages/react/src/components/zz.tsx", null, "const row = 1;\n")).toEqual([]);
    expect(added("specs/issues/zz/poc/x.mjs", null, "const row = 1;\n")).toEqual([]);
    expect(added("packages/workforce/README.md", null, "const row = 1;\n")).toEqual([]);
  });
});

describe("the added reach reads two real commits, as the hook and CI run it", () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@localhost", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8" });
  const write = (dir: string, files: Record<string, string>) => {
    for (const [p, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), text);
    }
  };
  const repo = (base: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), "retired-terms-"));
    git(dir, "init", "-q", "-b", "main");
    write(dir, base);
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "base");
    return dir;
  };
  type Run = { ok: boolean; changed: number; hits: Array<{ path: string; name: string }> };
  const since = addedSince as (root: string, base: string, head?: string) => Run;
  const moved = "export function plan(list: string[]) {\n  const row = list[0];\n  return row;\n}\n".repeat(4);

  it("refuses a new name and a copied file's names, and passes an edit, a rename and a deletion", () => {
    const dir = repo({
      "packages/workforce/src/old.ts": "export function load(x: unknown) {\n  const row = x;\n  return row;\n}\n",
      "packages/workforce/src/moving.ts": moved,
      "packages/workforce/src/gone.ts": "const row = 1;\n",
      "packages/workforce/src/stays.ts": "export const keep = (rows: string[]) => rows;\n",
    });
    try {
      write(dir, {
        "packages/workforce/src/old.ts": "export function load(x: unknown) {\n  const row = x ?? null;\n  return row;\n}\n",
        "packages/workforce/src/fresh.ts": "export function f(list: string[]) {\n  const taskRow = list[0];\n  return taskRow;\n}\n",
        // A copy of a file that stays: git reads it as added, so its names are new.
        "packages/workforce/src/copy.ts": "export const keep = (rows: string[]) => rows;\n",
      });
      git(dir, "mv", "packages/workforce/src/moving.ts", "packages/workforce/src/moved.ts");
      git(dir, "rm", "-q", "packages/workforce/src/gone.ts");
      git(dir, "add", "-A");
      git(dir, "commit", "-q", "-m", "head");
      // CI's form: the merge's first parent. The hook's form: a merge base and an explicit head.
      for (const r of [since(dir, "HEAD^1"), since(dir, git(dir, "rev-parse", "main~1").trim(), git(dir, "rev-parse", "HEAD").trim())]) {
        expect(r.ok).toBe(false);
        expect([...new Set(r.hits.map((h) => `${h.path}:${h.name}`))].sort()).toEqual(["packages/workforce/src/copy.ts:rows", "packages/workforce/src/fresh.ts:taskRow"]);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads a changed file whose name git would quote, so a non-ASCII path cannot pass unread", () => {
    // Git quotes a non-ASCII path in a line listing; a reader that matches it to the diff's name reads nothing.
    const dir = repo({ "packages/workforce/src/a.ts": "const a = 1;\n" });
    try {
      write(dir, { "packages/workforce/src/café.ts": "const row = 1;\n", "packages/workforce/src/tab\tname.ts": "const taskRow = 1;\n" });
      git(dir, "add", "-A");
      git(dir, "commit", "-q", "-m", "head");
      const r = since(dir, "HEAD^1") as Run & { unread: string[] };
      expect(r.ok).toBe(false);
      expect(r.hits.map((h) => `${h.path}:${h.name}`).sort()).toEqual(["packages/workforce/src/café.ts:row", "packages/workforce/src/tab\tname.ts:taskRow"]);
      // Both were read: none fell through to the unread list.
      expect(r.unread).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads the commits, not the working tree", () => {
    const dir = repo({ "packages/workforce/src/a.ts": "const a = 1;\n" });
    try {
      write(dir, { "packages/workforce/src/a.ts": "const row = 1;\n" });
      expect(since(dir, "HEAD").ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits 1 when the base does not resolve, so CI never skips", () => {
    const dir = repo({ "packages/workforce/src/a.ts": "const a = 1;\n" });
    try {
      expect(() => since(dir, "HEAD^1")).toThrow(/does not resolve/);
      const cli = spawnSync(process.execPath, [join(__dirname, "../../../scripts/check-retired-terms.mjs"), "--root", dir, "--added-since", "HEAD^1"], { encoding: "utf8" });
      expect(cli.status).toBe(1);
      expect(cli.stderr).toMatch(/does not resolve/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
