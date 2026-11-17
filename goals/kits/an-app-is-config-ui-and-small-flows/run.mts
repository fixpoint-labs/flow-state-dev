/**
 * Goal check, the closure of epic FIX-2618: an app on workforce is
 * configuration, UI and small flows. On one commit:
 *
 *   a  the Claude Code-style lab in a browser on a real model: a thread, a
 *      delegated coding task (the scripted coder), its row changing, a pin;
 *      and the lab's inventory (`a:inventory`)
 *   b  the teammates host on the same kits (`b:installs`, `b:folder`, `b:one-home`)
 *   w  every client write to a user or org resource is a request in a flow
 *      (`w:routes`, `w:no-runby`, `w:recorded`), read from leg a's run
 *   j4 a task's change re-reads its one row, and no socket frame carries a row
 *   j5 one hook: the retired read names stay gone, and a view calls no model
 *
 * `GOAL_LEGS=a,b,w,j4,j5` (the default) picks legs; leg w and j4 ride on leg a.
 *
 * Controls (`GOAL_CONTROL=<name>`, same command), each must FAIL what it names:
 *   - `todays-main`: the inventory on the lab as it was before the epic's first
 *     implementation merged (`705c14017a`). FAILS `a:inventory`.
 *   - `planted-adapter`: `src/glue.ts` planted in the lab: a client import, a
 *     subscribe and a row type. FAILS `a:inventory`.
 *   - `blind-recorder`: the view route answers the coding board's view with no
 *     topics, so no change reaches its watcher. FAILS `a:row-changes`.
 *   - `direct-write`: the content routes write a user or org collection instead
 *     of answering 501. FAILS `w:routes` and `w:recorded`.
 *   - `skip-unknown`: the kits' claim pass reports nothing unclaimed. FAILS `b:folder`.
 *
 * Run: cd goals && pnpm tsx kits/an-app-is-config-ui-and-small-flows/run.mts
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@flow-state-dev/client";
import { assertPatched, describePatches, goalAttempts, goalTmpDir, loadFixture, modulePatchEnv, REPO_ROOT, runGoal, RUN_STAMP, type ModulePatch, type Tell } from "../../lib/index.mts";
import { inventoryOf } from "./inventory.mts";
import { legA, type LegA } from "./leg-a.mts";
import { legB } from "./leg-b.mts";
import { probeWrites, recordedWrites } from "./leg-w.mts";
import { MODEL_VIEWS, PROBE_FLOW } from "./probe-flow.mts";

const fixture = loadFixture<{ ask: string }>(import.meta.url);
const CONTROL = process.env.GOAL_CONTROL ?? "";
const LEGS = new Set((process.env.GOAL_LEGS ?? "a,b,w,j4,j5").split(",").map((s) => s.trim()));
const LAB = join(REPO_ROOT, "labs/claude-code-style");
/** The parent of the epic's first implementation merge (#5090): the lab before the epic built anything. */
const TODAYS_MAIN = "705c14017a";

const VIEW_ROUTES = "packages/engine/src/routes/view-routes.ts";
const RESOURCE_ROUTES = "packages/engine/src/routes/resource-routes.ts";
const KITS = "packages/engine/src/flowstate/kits.ts";
/** Each runtime control's patch to the engine the app loads; nothing is written to the checkout. */
const PATCHES: Record<string, ModulePatch[]> = {
  "blind-recorder": [{ module: VIEW_ROUTES, from: String.raw`topics: answer\.topics,`, to: 'topics: route.viewName === "codingBoard" ? [] : answer.topics,' }],
  "direct-write": [{ module: RESOURCE_ROUTES, from: String.raw`if \(scope !== "session"\) \{`, to: 'if (scope !== "session" && false) {' }],
  "skip-unknown": [{ module: KITS, from: String.raw`await opened\.unclaimed\(\)`, to: "await opened.unclaimed().then(() => [])" }],
};
const KNOWN = ["", "todays-main", "planted-adapter", ...Object.keys(PATCHES)];
if (!KNOWN.includes(CONTROL)) throw new Error(`setup: unknown GOAL_CONTROL "${CONTROL}"; known: ${KNOWN.filter(Boolean).join(", ")}`);
const scratch = goalTmpDir("closure-an-app-is-config");
const MARK = join(scratch, "patched.txt");
const patchEnv = PATCHES[CONTROL] === undefined ? {} : modulePatchEnv(PATCHES[CONTROL]!, REPO_ROOT, MARK);
if (PATCHES[CONTROL] !== undefined) console.error(`control ${CONTROL}:\n${describePatches(PATCHES[CONTROL]!, REPO_ROOT)}`);

/** `a:inventory`, on the lab at `lab`. */
function gradeInventory(lab: string, failures: string[], notes: string[], rev?: string): void {
  const found = inventoryOf(lab, rev);
  for (const [rule, lines] of Object.entries(found)) {
    if (lines.length > 0) failures.push(`a:inventory: ${rule}: ${lines.slice(0, 6).join(" | ")}${lines.length > 6 ? ` … ${lines.length - 6} more` : ""}`);
  }
  notes.push(`inventory: ${Object.entries(found).map(([rule, lines]) => `${rule} ${lines.length === 0 ? "clean" : lines.length}`).join(", ")}`);
}

/** j5: the retired read names, planted, fail the glossary's check; each scope's model-calling view is refused. */
async function journeyFive(origin: string | undefined, user: string, failures: string[], notes: string[], tell: Tell): Promise<void> {
  const clean = spawnSync("node", ["scripts/check-retired-terms.mjs"], { cwd: REPO_ROOT, encoding: "utf8" });
  if (clean.status !== 0) failures.push(`j5:one-hook: the retired-terms check fails on the clean tree: ${clean.stdout.slice(-300)}`);
  // A tracked file, so the check reads it; put back after.
  const planted = join(REPO_ROOT, "packages/core/src/index.ts");
  const before = readFileSync(planted, "utf8");
  writeFileSync(planted, `${before}\nexport type ClosurePlant = { reads: ReadConfig };\n`);
  let red: ReturnType<typeof spawnSync>;
  try {
    red = spawnSync("node", ["scripts/check-retired-terms.mjs"], { cwd: REPO_ROOT, encoding: "utf8" });
  } finally {
    writeFileSync(planted, before);
  }
  if (red.status === 0 || !/flow-reads/.test(`${red.stdout}${red.stderr}`)) failures.push("j5:one-hook: a planted `reads: ReadConfig` passed the glossary's retired-terms check");
  else notes.push("j5:one-hook: the planted ReadConfig failed the retired-terms check (flow-reads)");
  if (origin === undefined) return;
  const fsd = createClient({ userId: user, baseUrl: origin });
  const sessionId = (await fsd.flow(PROBE_FLOW).createSession()).id;
  const answers = tell.over("j5:no-model · model-calling views", await Promise.all(
    (Object.entries(MODEL_VIEWS) as [string, string][]).map(async ([scope, view]) => {
      const res = await fetch(`${origin}/api/flows/${PROBE_FLOW}/${scope === "session" ? `${encodeURIComponent(sessionId)}/` : ""}views/${view}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: {} }) });
      return { scope, status: res.status, body: await res.json().catch(() => ({})) };
    }),
  ));
  for (const a of answers) if (a.status !== 422 || a.body.error !== "view_model_call") failures.push(`j5:no-model: a model call in a ${a.scope}-scope view answered ${a.status} ${JSON.stringify(a.body).slice(0, 160)}`);
  notes.push(`j5:no-model: ${answers.map((a) => `${a.scope} ${a.status} ${a.body.error ?? ""}`).join(", ")}`);
}

/** j4, from leg a's run: the board's re-reads carry one row, and no socket frame carries a row's values. */
function journeyFour(a: LegA, failures: string[], notes: string[], tell: Tell): void {
  const reads = tell.over("j4:one-row · the board's reads", a.boardReads.filter((r) => r.body !== undefined));
  const rereads = reads.slice(1);
  const partial = rereads.filter((r) => r.body.partial !== undefined || (Array.isArray(r.body.output) && r.body.output.length <= 1));
  const whole = rereads.filter((r) => !partial.includes(r));
  if (rereads.length === 0) failures.push("j4:one-row: the board was never re-read after a change");
  else if (partial.length === 0) failures.push(`j4:one-row: every one of the board's ${rereads.length} re-reads answered the whole board`);
  notes.push(`j4:one-row: ${reads.length} board reads, ${partial.length} re-reads carried one row, ${whole.length} answered whole (${whole.map((r) => r.body.output?.length ?? "?").join(",")})`);
  const values = [a.task?.title, a.task?.goal].filter((v): v is string => typeof v === "string" && v.length >= 12);
  tell.over("j4:no-rows · socket frames", a.frames, { emptyIs: "no frame at all is no row in a frame; leg a's row-changes reads the push" });
  const carrying = a.frames.filter((f) => values.some((v) => f.includes(v.slice(0, 40))));
  if (values.length === 0) failures.push("j4:no-rows: no task title or goal to look for");
  if (carrying.length > 0) failures.push(`j4:no-rows: ${carrying.length} socket frame(s) carry the task's title or goal: ${carrying[0]!.slice(0, 200)}`);
  notes.push(`j4:no-rows: ${a.frames.length} socket frames, ${carrying.length} carry a row's values`);
}

await runGoal(async (failures, tell) => {
  const notes: string[] = [];
  const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  notes.push(`commit ${commit}${CONTROL === "" ? "" : `, control ${CONTROL}`}`);

  // ── a:inventory, and its two static controls.
  if (CONTROL === "todays-main") {
    const old = join(scratch, "todays-main");
    mkdirSync(old, { recursive: true });
    execFileSync("sh", ["-c", `git archive ${TODAYS_MAIN} labs/claude-code-style | tar -x -C "${old}"`], { cwd: REPO_ROOT });
    gradeInventory(join(old, "labs/claude-code-style"), failures, notes, TODAYS_MAIN);
    return { failures, evidence: notes.join(" · ") };
  }
  if (CONTROL === "planted-adapter") {
    const glue = join(LAB, "src/glue.ts");
    writeFileSync(glue, 'import { createClient } from "@flow-state-dev/client";\nexport interface BoardRow { id: string; status: string }\nexport const watch = (c: any) => c.subscribe([], {});\n');
    try {
      gradeInventory(LAB, failures, notes);
    } finally {
      rmSync(glue, { force: true });
    }
    return { failures, evidence: notes.join(" · ") };
  }
  if (LEGS.has("a")) gradeInventory(LAB, failures, notes);

  // ── leg b
  if (LEGS.has("b")) await legB(failures, notes, tell, patchEnv, new Set(CONTROL === "skip-unknown" ? ["b:folder"] : ["b:installs", "b:folder", "b:one-home"]));
  if (CONTROL === "skip-unknown") return { failures, evidence: notes.join(" · ") };

  // ── leg a in the browser, then w, j4 and j5 on the same lab.
  let a: LegA | undefined;
  if (LEGS.has("a")) {
    for (let n = 1; n <= goalAttempts(); n++) {
      a?.stop();
      a = await legA(n, fixture.ask.replace("{marker}", `Closure ${RUN_STAMP}`), failures, notes, tell, patchEnv);
      if (a.outcome === "graded") break;
      if (CONTROL !== "") break;
      notes.push(`attempt ${n}: the model gave nothing to grade; retrying`);
    }
  }
  try {
    if (a !== undefined && a.origin !== undefined && a.store !== undefined) {
      if (LEGS.has("w")) {
        await probeWrites(a.origin, a.user, a.store, failures, notes, tell);
        // The store sees the probes' writes (none, unless a route wrote) before they're matched.
        await new Promise((r) => setTimeout(r, 1_000));
        notes.push(`w:recorded: ${recordedWrites(a.versions, a.store, a.user, a.startedAt, failures, tell)}`);
      }
      if (LEGS.has("j4")) journeyFour(a, failures, notes, tell);
    }
    if (LEGS.has("j5")) await journeyFive(a?.origin, a?.user ?? "", failures, notes, tell);
  } finally {
    a?.stop();
  }
  if (PATCHES[CONTROL] !== undefined) assertPatched(PATCHES[CONTROL]!, REPO_ROOT, MARK);
  console.error(`notes:\n  ${notes.join("\n  ")}`);
  return { failures, evidence: notes.join(" · ") };
});
