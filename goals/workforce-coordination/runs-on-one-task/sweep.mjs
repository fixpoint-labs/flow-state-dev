#!/usr/bin/env node
/**
 * FIX-2087 task-surface sweep: no task tool beyond the five (and the worker's `askQuestion`
 * and `waitForUser`, FIX-2131), nothing the epic's migration table removes is live,
 * nothing records a task's ending except the claim gate or the drain, and nothing but the
 * Inbox read builds a list of what waits on the user (FIX-2133). CI's Typecheck job runs
 * it, and again with `--control`; `run.mts` runs the same engine as the goal's sweep leg.
 *
 *   node goals/workforce-coordination/runs-on-one-task/sweep.mjs            # report + verdict
 *   node goals/workforce-coordination/runs-on-one-task/sweep.mjs --rows     # how each migration row is covered
 *   node goals/workforce-coordination/runs-on-one-task/sweep.mjs --control  # every plant must be reported
 *   node goals/workforce-coordination/runs-on-one-task/sweep.mjs --json     # the result as one JSON line (run.mts)
 *
 * Exit 0 = PASS, 1 = FAIL, 3 = CAN'T TELL (a rule read nothing, an allowed tool wasn't read, or a
 * recorder's name names more than one function).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { sweepTaskSurface } from "./engine.mjs";
import { MIGRATION_TABLE, ROOTS, TOOLS_ALLOWED } from "./rules.mjs";

const args = new Set(process.argv.slice(2));
const repo = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

/** The capability's file, copied into plants so a planted tool is read the way the real ones are. */
const CAPABILITY = "packages/orchestration/src/skills/task-tools-capability.ts";
const COLLECTION = 'import type { TaskCollectionRef, TaskClaimTicket } from "@flow-state-dev/orchestration/tasks";\n';

/**
 * The negative control: plants per rule, each in a file the sweep reads through the same path as
 * a real one. Each must be reported `expect` times (default once) and nothing else may change.
 * `cantTell` is how many CAN'T TELL lines a plant adds.
 */
function plantsOf(root) {
  const capability = readFileSync(join(root, CAPABILITY), "utf8");
  const anchor = "  const createTask = defineTool({";
  if (!capability.includes(anchor) || !capability.includes("const defineTool = ")) throw new Error(`the control can't plant: ${CAPABILITY} has no \`${anchor.trim()}\``);
  // A copy of the capability with its local alias renamed, a sixth tool built with it, one with a
  // template name, two built as a sequencer and a generator under renamed imports, and two tools
  // imported from sibling files: one through a renamed import of `handler`, one through a
  // namespace import.
  const copy =
    'import { nudge } from "./__planted_side_tool__";\nimport { prod } from "./__planted_namespace_tool__";\n' +
    'import { sequencer as seq2, generator as gen2 } from "@flow-state-dev/core";\nexport const seqTask = seq2({ name: "seqTask" } as any);\nexport const genTask = gen2({ name: "genTask" } as any);\n' +
    capability
      .replace(anchor, '  const poke = defineTool({ name: named("pokeTask"), description: "Poke a task." } as any);\n  const twice = defineTool({ name: `poke${"Twice"}` } as any);\n' + anchor)
      .replaceAll("defineTool", "makeTool");
  return [
    { rule: "tools", path: "packages/orchestration/src/skills/__planted_capability__.ts", text: copy, expect: 4 },
    {
      rule: "tools",
      path: "packages/orchestration/src/skills/__planted_side_tool__.ts",
      text: 'import { handler as defineIt } from "@flow-state-dev/core";\nexport const nudge = defineIt({ name: "nudgeTask" } as any);\n',
    },
    {
      rule: "tools",
      path: "packages/orchestration/src/skills/__planted_namespace_tool__.ts",
      text: 'import * as core from "@flow-state-dev/core";\nexport const prod = core.handler({ name: "prodTask" } as any);\n',
    },
    {
      rule: "removed",
      path: "packages/workforce/src/__planted_removed__.ts",
      text: "export const legacy = { tool: \"dispatchTask\" };\n",
    },
    {
      // A name FIX-2058's ratchet removed (PERSON_STOPS_REMOVED), back in package source.
      rule: "removed",
      path: "packages/shift-manager/src/lib/__planted_person_stop__.ts",
      text: 'export const REOPENED_SOURCES: ReadonlySet<string> = new Set(["http"]);\n',
    },
    {
      rule: "endings",
      path: "packages/workforce/src/__planted_complete__.ts",
      text: COLLECTION + "export async function wrapUp(rows: TaskCollectionRef, taskId: string, output: unknown) {\n  const renamed = rows;\n  await renamed.complete(taskId, output);\n}\n",
    },
    {
      rule: "endings",
      path: "packages/workforce/src/__planted_cancel__.ts",
      text: COLLECTION + "export async function giveUp(board: TaskCollectionRef, id: string, claim: TaskClaimTicket) {\n  await board.cancel(id, \"done here\", { claim });\n}\n",
    },
    {
      rule: "endings",
      path: "packages/orchestration/src/__planted_renamed_helper__.ts",
      text: 'import { advisoryComplete as done } from "./tasks/collection/advisory-write-back";\nexport async function finish(ref: any, id: string) {\n  await done(ref, id, "ok");\n}\n',
    },
    {
      rule: "endings",
      path: "packages/orchestration/src/__planted_namespace_helper__.ts",
      text: 'import * as writes from "./tasks/collection/advisory-write-back";\nexport async function flop(ref: any, id: string) {\n  await writes.advisoryFail(ref, id, "no");\n}\n',
    },
    {
      rule: "endings",
      path: "packages/workforce/src/__planted_destructured__.ts",
      text: COLLECTION + "export async function wrapUp(rows: TaskCollectionRef, id: string) {\n  const { complete } = rows;\n  await complete(id, 1);\n}\n",
    },
    {
      rule: "endings",
      path: "packages/workforce/src/__planted_element__.ts",
      text: COLLECTION + 'export async function giveUp(rows: TaskCollectionRef, id: string) {\n  await rows["fail"](id, "no");\n}\n',
    },
    {
      rule: "endings",
      path: "packages/workforce/src/__planted_call__.ts",
      text: COLLECTION + "export async function wrapUp(rows: TaskCollectionRef, id: string) {\n  await rows.complete.call(rows, id, 1);\n}\n",
    },
    {
      // A claim-passing cancel in each indirect shape: `.call`, `.apply`, `.bind`, destructured, element access.
      rule: "endings",
      path: "packages/workforce/src/__planted_cancel_shapes__.ts",
      text:
        COLLECTION +
        "export async function giveUp(board: TaskCollectionRef, id: string, claim: TaskClaimTicket) {\n" +
        '  await board.cancel.call(board, id, "done", { claim });\n' +
        '  await board.cancel.apply(board, [id, "done", { claim }]);\n' +
        "  const later = board.cancel.bind(board);\n" +
        "  const { cancel: stop } = board;\n" +
        '  await stop(id, "done", { claim });\n' +
        '  await board["cancel"](id, "done", { claim });\n' +
        "  return later;\n}\n",
      expect: 5,
    },
    {
      // The same shapes with no claim are a plain cancel, not an ending: nothing is reported.
      rule: "endings",
      path: "packages/workforce/src/__planted_cancel_unclaimed__.ts",
      text:
        COLLECTION +
        "export async function dropIt(board: TaskCollectionRef, id: string) {\n" +
        '  await board.cancel.call(board, id, "not needed");\n' +
        '  await board.cancel.apply(board, [id, "not needed"]);\n' +
        "  const { cancel: stop } = board;\n" +
        '  await stop(id, "not needed");\n' +
        '  await board["cancel"](id, "not needed");\n}\n',
      expect: 0,
    },
    ...doorPlants(root),
    forwarderPlant(root),
    {
      rule: "endings",
      path: "packages/orchestration/src/__planted_bound_helper__.ts",
      text: 'import * as writes from "./tasks/collection/advisory-write-back";\nconst { advisoryFail: f } = writes;\nexport async function flop2(ref: any, id: string) {\n  await f(ref, id, "no");\n}\n',
    },
    {
      rule: "endings",
      path: "packages/orchestration/src/__planted_passed_helper__.ts",
      text: 'import { advisoryComplete } from "./tasks/collection/advisory-write-back";\nexport async function later(run: (...a: any[]) => Promise<unknown>, ref: any, id: string) {\n  await run(ref, id, "ok");\n}\nexport const go = (ref: any, id: string) => later(advisoryComplete, ref, id);\n',
    },
    ...inboxPlants(),
    {
      // A second function named like a recorder: its write would be read as the recorder's.
      rule: "endings",
      path: "packages/orchestration/src/__planted_recorder__.ts",
      text: COLLECTION + "export async function releaseRow(rows: TaskCollectionRef, id: string) {\n  await rows.complete(id, 1);\n}\n",
      cantTell: 1,
    },
  ];
}

/**
 * The floor's control: the real capability with `createTask` built by something other than
 * `handler`. The tools rule then can't read an allowed name, and must say it can't tell.
 */
/**
 * A removed door brought back in each built-in worker flow: `message` in the agent's (its config
 * is `configSchema: settings` and `...bound`, so no text names the worker contract), and `run`
 * under a computed key in the coordinator's (its config sits under `as never`).
 */
const AGENT_FLOW = "packages/workforce/src/agent-worker-flow.ts";
const COORDINATOR_FLOW = "packages/workforce/src/coordinator/coordinator-flow.ts";
function doorPlants(root) {
  const agent = readFileSync(join(root, AGENT_FLOW), "utf8");
  const coordinator = readFileSync(join(root, COORDINATOR_FLOW), "utf8");
  const anchor = "      [STANDING_RULES_ACTION]: standingRulesAction";
  if (agent.split(anchor).length !== 2 || coordinator.split(anchor).length !== 2) throw new Error(`the control can't plant: ${AGENT_FLOW} and ${COORDINATOR_FLOW} each need one \`${anchor.trim()}\``);
  return [
    { rule: "removed", path: AGENT_FLOW, text: agent.replace(anchor, `      message: { block: userTurn } as any,\n${anchor}`) },
    { rule: "removed", path: COORDINATOR_FLOW, text: coordinator.replace(anchor, `      [("run") as "run"]: { block: door } as any,\n${anchor}`) },
  ];
}

/** Writes planted inside a collection wrapper: only its forwarding is exempt, so each is reported. */
const BOARD = "packages/workforce/src/conversation-board/board.ts";
function forwarderPlant(root) {
  const board = readFileSync(join(root, BOARD), "utf8");
  const anchor = "    const ending =\n      (write:";
  if (!board.includes(anchor)) throw new Error(`the control can't plant: ${BOARD} has no \`const ending =\` in guarded`);
  // A direct call, and calls through `.call` and `.apply`: each a write made in the forwarder, not a forwarding.
  const writes = '    void ref.fail("planted", "a direct write in a forwarder");\n' + '    void ref.fail.call(ref, "planted", "a write through .call");\n' + '    void ref.complete.apply(ref, ["planted", 1] as any);\n';
  return { rule: "endings", path: BOARD, text: board.replace(anchor, writes + anchor), expect: 3 };
}

/**
 * A second list of what waits on the user: an Inbox item built outside the Inbox read, in each
 * shape the rule reads. A typed literal (in a `.map` callback), a cast, shorthand properties, a
 * spread, and an untyped literal with an item's shape.
 */
function inboxPlants() {
  const fields = 'task: null, questions: [], since: 0, answerable: true, unanswerable: null';
  return [
    {
      rule: "inbox",
      path: "packages/shift-manager/src/lib/__planted_inbox_item__.ts",
      text:
        'import type { InboxItem } from "@flow-state-dev/orchestration/inbox";\n' +
        `export function myList(ids: string[]): InboxItem[] {\n  return ids.map((id) => ({ id, ${fields} }));\n}\n` +
        `export const one = (id: string) => ({ id, ${fields} }) as InboxItem;\n` +
        'export function short(id: string): InboxItem {\n  const task = null;\n  const questions: InboxItem["questions"] = [];\n  const answerable = true;\n  return { id, task, questions, since: 0, answerable, unanswerable: null };\n}\n' +
        `const base = { questions: [] as InboxItem["questions"], task: null };\nexport const spread = (id: string): InboxItem => ({ ...base, id, since: 0, answerable: true, unanswerable: null });\n` +
        `export const loose = (id: string) => ({ id, ${fields} });\n`,
      expect: 5,
    },
  ];
}

function floorPlant(root) {
  const capability = readFileSync(join(root, CAPABILITY), "utf8");
  const anchor = "const createTask = defineTool({";
  if (!capability.includes(anchor)) throw new Error(`the control can't plant: ${CAPABILITY} has no \`${anchor}\``);
  return [{ path: CAPABILITY, text: capability.replace(anchor, "const createTask = ((config: any) => config)({") }];
}

/**
 * An extracted tree has no `node_modules`, so a type from a dependency (zod's, which
 * `workerConfigSchema()` returns) wouldn't resolve. Give it this checkout's: the pnpm store
 * linked whole, and each `node_modules` link copied with its relative target, so a workspace
 * package still resolves to the extracted tree's source and a third-party one to the store.
 */
function linkDependencies(from, to) {
  const dirs = execFileSync("find", [from, "-name", "node_modules", "-type", "d", "-prune", "-not", "-path", "*/node_modules/*"], { encoding: "utf8" }).split("\n").filter(Boolean);
  for (const dir of dirs) {
    const target = join(to, relative(from, dir));
    if (!existsSync(dirname(target))) continue;
    mkdirSync(target, { recursive: true });
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".pnpm") symlinkSync(join(dir, entry.name), join(target, entry.name));
      else if (entry.isSymbolicLink()) symlinkSync(readlinkSync(join(dir, entry.name)), join(target, entry.name));
      else if (entry.isDirectory() && entry.name.startsWith("@")) {
        mkdirSync(join(target, entry.name));
        for (const scoped of readdirSync(join(dir, entry.name), { withFileTypes: true }))
          if (scoped.isSymbolicLink()) symlinkSync(readlinkSync(join(dir, entry.name, scoped.name)), join(target, entry.name, scoped.name));
      }
    }
  }
}

const started = Date.now();
const control = args.has("--control");
// `--at <commit>`: sweep another commit's tree (extracted with `git archive`), against this
// checkout's migration table, rules and plants: how today's main is shown to FAIL.
const atIndex = process.argv.indexOf("--at");
const at = atIndex >= 0 ? process.argv[atIndex + 1] : undefined;
let root = repo;
let tracked;
if (at !== undefined) {
  root = mkdtempSync(join(tmpdir(), "task-surface-"));
  execFileSync("sh", ["-c", `git -C "${repo}" archive --format=tar "${at}" | tar -x -C "${root}"`]);
  linkDependencies(repo, root);
  tracked = execFileSync("git", ["-C", repo, "ls-tree", "-r", "--name-only", at, "--", ...ROOTS], { encoding: "utf8" }).split("\n").filter(Boolean);
}
const table = at === undefined ? undefined : join(repo, MIGRATION_TABLE);
const plain = sweepTaskSurface({ repo: root, tracked, table });
const PLANTS = control ? plantsOf(root) : [];
const result = control ? sweepTaskSurface({ repo: root, tracked, table, plants: PLANTS }) : plain;
const floor = control ? sweepTaskSurface({ repo: root, tracked, table, plants: floorPlant(root) }) : undefined;
const secs = ((Date.now() - started) / 1000).toFixed(1);
if (args.has("--json")) {
  const { findings, cantTell, tools, scanned, rows } = result;
  console.log(JSON.stringify({ findings, cantTell, tools, scanned, rows, allowed: [...TOOLS_ALLOWED] }));
  process.exit(0);
}

const head = at ?? execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
const excluded = [...result.files.excluded.values()].reduce((a, b) => a + b, 0);
console.log(`commit ${head} · ${secs}s`);
console.log(`files: ${result.files.tracked} tracked · ${result.files.swept} swept by the removed rule · ${excluded} excluded · ${result.files.program} in the program`);
for (const [why, n] of result.files.excluded) console.log(`  excluded ${n} · ${why}`);
console.log(`tools offered (${result.tools.length}): ${result.tools.join(", ")}`);
console.log(`worker flows read for doors (${result.workerFlows.length}): ${result.workerFlows.join(", ")}`);
console.log(`ending writes: ${result.scanned.endings} · by recorder ${JSON.stringify(result.recorders)}`);
console.log(`inbox: ${result.scanned.inbox} reads of what waits on the user, each in the Inbox read or a reason rules.mjs gives`);
console.log(`removed: ${result.rows.length} migration rows · ${result.scanned.removedText} text hits (${result.scanned.marked} marked retired-name-refusal · ${result.scanned.kept} kept by reason) · ${result.scanned.removedTyped} typed reads`);
if (args.has("--rows")) for (const r of result.rows) console.log(`  ${r.by.padEnd(28)} ${r.row.slice(0, 110)}`);

const byRule = (rule) => result.findings.filter((f) => f.rule === rule);
if (control) {
  const key = (f) => `${f.rule} ${f.where} ${f.what}`;
  const before = new Set(plain.findings.map(key));
  const added = result.findings.filter((f) => !before.has(key(f)));
  // A finding's place is `path:line`, or several joined by " and " (a key naming two functions).
  const at = (f, p) => f.rule === p.rule && f.where.split(" and ").some((w) => w.startsWith(`${p.path}:`));
  const of = (p) => added.filter((f) => at(f, p));
  const missed = PLANTS.filter((p) => of(p).length !== (p.expect ?? 1));
  const stray = added.filter((f) => !PLANTS.some((p) => at(f, p)));
  for (const p of PLANTS) console.log(`  plant ${p.rule.padEnd(8)} ${p.path}: ${of(p).length} of ${p.expect ?? 1} reported${missed.includes(p) ? "  MISSED" : ""}`);
  for (const f of stray) console.log(`  stray   ${f.rule} ${f.where}  ${f.what}`);
  const wantCantTell = plain.cantTell.length + PLANTS.reduce((n, p) => n + (p.cantTell ?? 0), 0);
  const floorOk = floor.cantTell.some((c) => c.startsWith("tools:") && c.includes("createTask")) && floor.findings.length === plain.findings.length;
  console.log(`  floor   createTask built apart from handler: ${floorOk ? "CAN'T TELL, as it must" : `NOT REPORTED (${JSON.stringify(floor.cantTell)})`}`);
  const expected = PLANTS.reduce((n, p) => n + (p.expect ?? 1), 0);
  if (missed.length > 0 || stray.length > 0 || added.length !== expected || result.cantTell.length !== wantCantTell || !floorOk) {
    console.log(`CONTROL BROKEN: ${missed.length} plant(s) not reported as expected, ${stray.length} other line(s) changed, ${added.length} added for ${expected} expected, ${result.cantTell.length} CAN'T TELL for ${wantCantTell}, floor ${floorOk ? "ok" : "missed"}`);
    process.exit(1);
  }
  console.log(`CONTROL OK: the plain run's ${plain.findings.length} live lines, exactly the ${expected} planted ones from ${PLANTS.length} plants, and the floor`);
  process.exit(0);
}

if (result.scanned.tools === 0 || result.scanned.endings === 0 || result.rows.length === 0 || result.cantTell.length > 0) {
  console.log(`CAN'T TELL — a rule read nothing (tools ${result.scanned.tools}, endings ${result.scanned.endings}, rows ${result.rows.length})${result.cantTell.map((c) => `\n  ${c}`).join("")}`);
  for (const f of result.findings) console.log(`  ${f.rule.padEnd(8)} ${f.where}  ${f.what}`);
  process.exit(3);
}
if (result.findings.length === 0) {
  console.log("PASS — no task tool beyond the allow list, nothing the migration table removes is live, every ending write is a recorder's, one Inbox list");
  process.exit(0);
}
console.log(`FAIL — ${result.findings.length} live lines (tools ${byRule("tools").length} · removed ${byRule("removed").length} · endings ${byRule("endings").length} · inbox ${byRule("inbox").length})`);
for (const f of result.findings) console.log(`  ${f.rule.padEnd(8)} ${f.where}  ${f.what}`);
process.exit(1);
