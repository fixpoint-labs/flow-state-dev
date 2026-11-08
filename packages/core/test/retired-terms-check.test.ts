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

/** The three released messages a published page may still quote (FIX-2479 D4). */
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
      "  type ResourceStateRow,",
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
    expect(resourceHits("packages/react/src/components/panels/cards.ts", "export type BoardCardRow = { id: string };\n")).toEqual([]);
    expect(resourceHits("packages/shift-manager/src/surfaces/roster/list.tsx", "export function WorkerRow() {}\n")).toEqual([]);
    // The same names one folder over are a read model, not a rendered row.
    expect(resourceHits("packages/shift-manager/src/lib/zz.ts", "export type WorkerRow = { id: string };\n")).toEqual(["1:export type WorkerRow = { id: string };"]);
    // The path keeps Row only: a CollectionItem name and a lifecycle State still count there.
    expect(resourceHits("packages/react/src/components/panels/zz.ts", "export type FooCollectionItem = { id: string };\n")).toHaveLength(1);
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
