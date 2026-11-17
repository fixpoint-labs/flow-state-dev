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
 *   j2 Shift Manager opens Projects, Usage and Schedules: each draws, none makes a session
 *      only to read, and reading writes nothing but Usage's one Re-check
 *   seam a pin through the default write flow reaches a view in another flow within 1 s
 *   j4 a task's change re-reads its one row, and no socket frame carries a row
 *   j5 one hook: the retired read names stay gone, and a view calls no model
 *
 * `GOAL_LEGS=a,b,w,seam,j2,j4,j5` (the default) picks legs; w, seam and j4 ride on leg a.
 *
 * Controls (`GOAL_CONTROL=<name>`, same command), each must FAIL what it names:
 *   - `todays-main`: the inventory on the lab as it was before the epic's first
 *     implementation merged (`705c14017a`). FAILS `a:inventory`.
 *   - `planted-adapter`: `src/glue.ts` planted in the lab: a client import, a
 *     subscribe and a row type. FAILS `a:inventory`.
 *   - `blind-recorder`: the view route answers the coding board's view with no
 *     topics, and the seam's `pinsSeen` view, so no change reaches
 *     their watchers. FAILS `a:row-changes` and `seam:pin-reaches-view`.
 *   - `direct-write`: the content routes write a user or org collection instead
 *     of answering 501. FAILS `w:routes` and `w:recorded`.
 *   - `direct-write-busy`: `direct-write`, made while a request of the user's is running.
 *     FAILS `w:recorded`, which a match by time alone would pass.
 *   - `half-partial`: every other change-driven re-read of the coding board drops the notice
 *     naming its rows and answers the whole board. FAILS `j4:one-row`.
 *   - `no-work-ask`: the lead is asked for no work, one attempt. FAILS `a:delegate` (nothing to grade).
 *   - `skip-unknown`: the kits' claim pass reports nothing unclaimed. FAILS `b:folder`.
 *   - `schedules-write`: Shift Manager's Schedules sends a write each time it reads (pages built
 *     from a patched copy). FAILS `j2:read-writes-nothing`.
 *
 * Run: cd goals && pnpm tsx kits/an-app-is-config-ui-and-small-flows/run.mts
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@flow-state-dev/client";
import { assertPatched, describePatches, goalAttempts, goalTmpDir, loadFixture, modulePatchEnv, REPO_ROOT, runGoal, RUN_STAMP, type ModulePatch, type Tell } from "../../lib/index.mts";
import { inventoryOf } from "./inventory.mts";
import { journeyTwo } from "./journey-j2.mts";
import { legA, type LegA } from "./leg-a.mts";
import { legB } from "./leg-b.mts";
import { pinSeam, probeWrites, recordedWrites } from "./leg-w.mts";
import { MODEL_VIEWS, PROBE_FLOW } from "./probe-flow.mts";

const fixture = loadFixture<{ ask: string }>(import.meta.url);
const CONTROL = process.env.GOAL_CONTROL ?? "";
const LEGS = new Set((process.env.GOAL_LEGS ?? "a,b,w,seam,j2,j4,j5").split(",").map((s) => s.trim()));
const LAB = join(REPO_ROOT, "labs/claude-code-style");
/** The parent of the epic's first implementation merge (#5090): the lab before the epic built anything. */
const TODAYS_MAIN = "705c14017a";

const VIEW_ROUTES = "packages/engine/src/routes/view-routes.ts";
const RESOURCE_ROUTES = "packages/engine/src/routes/resource-routes.ts";
const KITS = "packages/engine/src/flowstate/kits.ts";
/** Each runtime control's patch to the engine the app loads; nothing is written to the checkout. */
const PATCHES: Record<string, ModulePatch[]> = {
  "blind-recorder": [{ module: VIEW_ROUTES, from: String.raw`topics: answer\.topics,`, to: 'topics: route.viewName === "codingBoard" || route.viewName === "pinsSeen" ? [] : answer.topics,' }],
  // The content routes stop refusing user and org scope, and a create stores its entry in the
  // caller's user cell (the lab's org), as a route that wrote by scope would: no flow, no request.
  "direct-write": [
    { module: RESOURCE_ROUTES, from: String.raw`if \(scope !== "session"\) \{`, to: 'if (scope !== "session" && false) {' },
    {
      module: RESOURCE_ROUTES,
      from: String.raw`sessionStorageScope\(session, scopeId\),\s*scopeId,\s*storageKey,\s*initialState,`,
      to: '"user",\n    `${session.userId}:~org:claude-code-style-lab`,\n    storageKey,\n    initialState,',
    },
  ],
  // Half of the board's change-driven re-reads drop the notice that names their rows, so they answer the whole board.
  "half-partial": [
    {
      module: VIEW_ROUTES,
      from: String.raw`const changed = changeOf\(body\.changed\);`,
      to: 'const changed = route.viewName === "codingBoard" && ((globalThis.__closureHalf = ((globalThis.__closureHalf ?? 0) + 1) % 2) === 0) ? undefined : changeOf(body.changed);',
    },
  ],
  "skip-unknown": [{ module: KITS, from: String.raw`await opened\.unclaimed\(\)`, to: "await opened.unclaimed().then(() => [])" }],
};
// The same direct write, while another request of the user's runs: a match by time alone passes it.
PATCHES["direct-write-busy"] = PATCHES["direct-write"]!;
const KNOWN = ["", "todays-main", "planted-adapter", "schedules-write", "no-work-ask", ...Object.keys(PATCHES)];
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

/** The glossary's vocabulary sweep, which reads its `check: "sweep"` retirements (`flow-reads`, `scope-derived`). */
const SWEEP = "goals/vocabulary/one-word-per-thing/sweep.mjs";

/** j5: the retired read names, planted, fail the glossary's sweep; each scope's model-calling view is refused. */
async function journeyFive(origin: string | undefined, user: string, failures: string[], notes: string[], tell: Tell): Promise<void> {
  const clean = spawnSync("node", [SWEEP], { cwd: REPO_ROOT, encoding: "utf8" });
  if (clean.status !== 0) failures.push(`j5:one-hook: the vocabulary sweep fails on the clean tree: ${clean.stdout.slice(-300)}`);
  // A tracked file, so the check reads it; put back after.
  const planted = join(REPO_ROOT, "packages/core/src/index.ts");
  const before = readFileSync(planted, "utf8");
  writeFileSync(planted, `${before}\nexport type ClosurePlant = { reads: ReadConfig };\n`);
  let red: ReturnType<typeof spawnSync>;
  try {
    red = spawnSync("node", [SWEEP], { cwd: REPO_ROOT, encoding: "utf8" });
  } finally {
    writeFileSync(planted, before);
  }
  if (red.status === 0 || !/"flow-reads":[1-9]/.test(`${red.stdout}${red.stderr}`)) failures.push("j5:one-hook: a planted `reads: ReadConfig` passed the glossary's vocabulary sweep");
  else notes.push("j5:one-hook: the sweep passed the tree and failed the planted ReadConfig (flow-reads 1)");
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

/**
 * j4, from leg a's run. `j4:one-row`: every re-read the page sent on a change notice that named
 * rows (`changed.ids`) answers only those rows, flagged `partial`, while the board holds more than
 * one task (the goal files a second), so a whole-board answer shows as more rows than the notice
 * named. First reads and reloads name no notice and are counted apart. `j4:no-rows`: no socket
 * frame carries a task's title or goal.
 */
function journeyFour(a: LegA, failures: string[], notes: string[], tell: Tell): void {
  const reads = a.boardReads.filter((r) => r.body !== undefined);
  // The board's rows by key, from every answer: a notice whose ids are all rows of the board names rows. One whose
  // ids are something else (a run, a session's items) can't be answered row by row, and is counted apart.
  const boardKeys = new Set(reads.flatMap((r) => (Array.isArray(r.body.keys) ? (r.body.keys as string[]) : Array.isArray(r.body.output) ? (r.body.output as { id?: string }[]).map((row) => row.id ?? "") : [])));
  const namesRows = (r: (typeof reads)[number]) => (r.changed?.ids?.length ?? 0) > 0 && r.changed!.ids!.every((id) => boardKeys.has(id));
  const named = tell.over("j4:one-row · re-reads on a notice that named board rows", reads.filter(namesRows));
  const other = reads.filter((r) => (r.changed?.ids?.length ?? 0) > 0 && !namesRows(r));
  const unnamed = reads.length - named.length - other.length;
  const boardSize = Math.max(0, ...reads.filter((r) => r.body.partial === undefined && Array.isArray(r.body.output)).map((r) => r.body.output.length));
  if (boardSize < 2) failures.push(`j4:one-row: the board never held two tasks in a whole answer (largest ${boardSize}), so a whole answer can't be told from one row`);
  for (const r of named) {
    const rows = Array.isArray(r.body.output) ? r.body.output.length : NaN;
    if (r.body.partial === undefined || r.body.partial === false) failures.push(`j4:one-row: a re-read on a notice naming ${r.changed!.ids!.length} row(s) answered the whole board (${rows} rows)`);
    else if (!(rows <= r.changed!.ids!.length)) failures.push(`j4:one-row: a partial re-read on a notice naming ${r.changed!.ids!.length} row(s) carried ${rows}`);
  }
  notes.push(`j4:one-row: ${reads.length} board reads: ${named.length} on a notice naming rows (${named.map((r) => `${r.body.partial === undefined ? "whole" : "partial"} ${Array.isArray(r.body.output) ? r.body.output.length : "?"}/${r.changed!.ids!.length}`).join(", ")}), ${other.length} on a notice naming other ids (${other.map((r) => `${(r.changed as { kind?: string }).kind} ${r.body.partial === undefined ? "whole" : "partial"}`).join(", ")}), ${unnamed} first reads, reloads or notices naming nothing; the board held up to ${boardSize}`);
  const values = [a.task?.title, a.task?.goal].filter((v): v is string => typeof v === "string" && v.length >= 12);
  tell.over("j4:no-rows · socket frames", a.frames, { emptyIs: "no frame at all is no row in a frame; leg a's row-changes reads the push" });
  const carrying = a.frames.filter((f) => values.some((v) => f.includes(v.slice(0, 40))));
  if (values.length === 0) failures.push("j4:no-rows: no task title or goal to look for");
  if (carrying.length > 0) failures.push(`j4:no-rows: ${carrying.length} socket frame(s) carry the task's title or goal: ${carrying[0]!.slice(0, 200)}`);
  notes.push(`j4:no-rows: ${a.frames.length} socket frames, ${carrying.length} carry a row's values`);
}

await runGoal(async (failures, tell) => {
  const notes: string[] = [];
  // What each leg saw, printed however the run ends: a throw keeps the notes before it.
  process.on("exit", () => console.error(`notes:\n  ${notes.join("\n  ")}`));
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

  // ── journey j2: Shift Manager reads user and org data
  if (LEGS.has("j2") || CONTROL === "schedules-write") await journeyTwo(CONTROL, failures, notes, tell);
  if (CONTROL === "schedules-write") return { failures, evidence: notes.join(" · ") };

  // ── leg a in the browser, then w, j4 and j5 on the same lab.
  let a: LegA | undefined;
  if (LEGS.has("a")) {
    // The control `no-work-ask` asks for no work: the lead files nothing, and the leg must not pass on that.
    const ask = CONTROL === "no-work-ask" ? "Thanks, that's everything for today." : fixture.ask.replace("{marker}", `Closure ${RUN_STAMP}`);
    const attempts = CONTROL === "no-work-ask" ? 1 : goalAttempts();
    for (let n = 1; n <= attempts; n++) {
      a?.stop();
      a = await legA(n, ask, failures, notes, tell, patchEnv);
      if (a.outcome === "graded") break;
      if (CONTROL !== "" && CONTROL !== "no-work-ask") break;
      notes.push(`attempt ${n}: the model gave nothing to grade${n < attempts ? "; retrying" : ""}`);
    }
    if (a?.outcome === "retry") failures.push(`a:delegate: the model gave nothing to grade in ${attempts} attempt(s) (no coding task filed, or the judge sent every scripted run back), so legs a, w, seam and j4 graded nothing`);
  }
  try {
    if (a !== undefined && a.origin !== undefined && a.store !== undefined) {
      if (LEGS.has("w")) {
        if (CONTROL === "direct-write-busy" && a.sessionId !== undefined) {
          // Another request of the user's runs while the probes write: the lead answering a line.
          await createClient({ userId: a.user, baseUrl: a.origin }).flow("coordinator").send("respond", { message: "Say only: ok." }, { sessionId: a.sessionId });
          await new Promise((r) => setTimeout(r, 300));
        }
        await probeWrites(a.origin, a.user, a.store, failures, notes, tell);
      }
      if (LEGS.has("seam")) await pinSeam(a.origin, a.user, failures, notes, tell);
      if (LEGS.has("w")) {
        // The log sees the last writes (the probes', the seam's pins) before they're matched.
        await new Promise((r) => setTimeout(r, 1_000));
        notes.push(`w:recorded: ${recordedWrites(a.versions, a.gaps, a.store, a.user, a.startedAt, failures, tell)}`);
      }
      if (LEGS.has("j4")) journeyFour(a, failures, notes, tell);
    }
    if (LEGS.has("j5")) await journeyFive(a?.origin, a?.user ?? "", failures, notes, tell);
  } finally {
    a?.stop();
  }
  if (PATCHES[CONTROL] !== undefined) assertPatched(PATCHES[CONTROL]!, REPO_ROOT, MARK);
  return { failures, evidence: notes.join(" · ") };
});
