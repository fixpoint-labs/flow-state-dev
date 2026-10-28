/**
 * Goal check for FIX-2142. See goal.md.
 *
 * Run:      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/shift-manager/it-shows-claude-usage-left/run.mts
 * Controls: GOAL_CONTROL=no-scale | absent-as-zero | fan-out | read-replaces-run
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { REPO_ROOT, RUN_STAMP, goalTmpDir, runGoal } from "../../lib/index.mts";
import { assertPatched, describePatches, modulePatchEnv } from "../../lib/module-patch.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { buildShiftManagerPages, labRoutes, openShiftManager, personPage, startShiftManager, type LabUser } from "../../lib/shift-manager.mts";
import { LAB_CROWD, LAB_USERS, PROJECTS_FLOW } from "../../../packages/shift-manager/teams/devteam/host.mts";
import { CODER_FLOW } from "../../../packages/shift-manager/teams/devteam/workforce/flows/workers/coder.mts";
import { LIST_TASKS_ACTION } from "../../../packages/shift-manager/src/lib/conversation-tasks.ts";
import { CONTROL_NAMES, CONTROLS, FAULTS, sdkSeam, type Control } from "./controls.mts";

const SCRATCH = goalTmpDir("claude-usage");
const say = (s: string) => console.error(`[claude-usage ${new Date().toISOString().slice(11, 19)}] ${s}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const controlName = process.env.GOAL_CONTROL ?? "";
if (controlName !== "" && !(CONTROL_NAMES as readonly string[]).includes(controlName)) {
  console.error(`unknown GOAL_CONTROL "${controlName}"; known: ${CONTROL_NAMES.join(", ")}`);
  process.exit(2);
}
const control: Control | undefined = controlName === "" ? undefined : CONTROLS[controlName as keyof typeof CONTROLS];

/** One person per leg, so each leg reads a row only it wrote. */
const PEOPLE = {
  a: { label: "a", ...LAB_CROWD[0]! },
  b: { label: "b", ...LAB_CROWD[1]! },
  c: { label: "c", ...LAB_CROWD[2]! },
  alice: { label: "alice", ...LAB_USERS.owner },
  bob: { label: "bob", ...LAB_USERS.member },
  e: { label: "e", ...LAB_CROWD[3]! },
  eSwitch: { label: "e-switch", ...LAB_CROWD[4]! },
  eEmpty: { label: "e-empty", ...LAB_USERS.outsider },
  fOrder: { label: "f-order", ...LAB_CROWD[5]! },
  fOld: { label: "f-old", ...LAB_CROWD[6]! },
} satisfies Record<string, LabUser & { label: string }>;

type Window = { id: string; minutes: number | null; usedPercent: number | null; level: string | null; resetsAt: number | null; checkedAt: number; origin: string; ageMs: number; rolledOver: boolean };
type Row = { harness: string; status: string; reason: string | null; plan: string | null; windows: Window[]; checkedAt: number | null; ageMs: number | null; refreshError: string | null };

/** A `rate_limit_event`'s `rate_limit_info`, as the pinned CLI builds each status (FIX-2142's POC). */
const RESETS = Math.floor(Date.now() / 1000) + 2 * 3600;
const event = {
  allowed: (window = "five_hour") => ({ status: "allowed", resetsAt: RESETS, rateLimitType: window }),
  warning: (utilization: number, window = "five_hour") => ({ status: "allowed_warning", resetsAt: RESETS, rateLimitType: window, utilization }),
  rejected: (window = "five_hour") => ({ status: "rejected", resetsAt: RESETS, rateLimitType: window }),
  apiKey: () => ({ status: "allowed" }),
};

await runGoal(async () => {
  const started = Date.now();
  const mark = join(SCRATCH, `patch-mark-${RUN_STAMP}`);
  const scriptedSdk = pathToFileURL(fileURLToPath(new URL("./lab/scripted-sdk.mjs", import.meta.url))).href;
  const patches = [sdkSeam(scriptedSdk), ...FAULTS, ...(control?.patches ?? [])];
  const patchEnv = modulePatchEnv(patches, REPO_ROOT, mark);
  if (control !== undefined) say(`control ${control.name}: ${control.does}\n${describePatches(control.patches, REPO_ROOT)}`);

  // The homes the real probe reads: nobody signed in, and the same with an API key.
  const emptyHome = mkdtempSync(join(SCRATCH, "claude-empty-"));
  const setupFile = join(SCRATCH, "setup.json");
  const runLog = join(SCRATCH, "runs.log");
  writeFileSync(runLog, "");
  const runs: Record<string, unknown> = {};
  let probe: unknown = { mode: "scripted", account: {} };
  let reader: { home: string; apiKey?: string } = { home: emptyHome };
  const writeSetup = () => writeFileSync(setupFile, JSON.stringify({ log: runLog, runs, probe, reader }));
  /** What the run tagged `tag` sends, and the account it names. */
  const script = (tag: string, events: Array<{ info: unknown; waitFor?: string }>, account: Record<string, string> = {}, accountDelayMs = 0) => {
    runs[tag] = { events, account, accountDelayMs };
    writeSetup();
  };
  /** The look's account: a scripted sign-in, or the real probe on an empty home or an API key. */
  const signIn = (account: Record<string, string>) => {
    probe = { mode: "scripted", account };
    writeSetup();
  };
  const realProbe = (apiKey?: string) => {
    probe = { mode: "real" };
    reader = { home: emptyHome, ...(apiKey === undefined ? {} : { apiKey }) };
    writeSetup();
  };
  const started_ = (tag: string) => readFileSync(runLog, "utf8").split("\n").filter((l) => l.startsWith(`RUN ${tag} `)).map((l) => Number(l.split(" ")[2]));
  writeSetup();

  say("building Shift Manager's pages");
  const pages = await buildShiftManagerPages(join(SCRATCH, "pages"));
  const storeDir = join(SCRATCH, "store");
  mkdirSync(storeDir, { recursive: true });
  const served = await startShiftManager({
    scratch: SCRATCH,
    label: "claude-usage",
    config: fileURLToPath(new URL("./lab/fsdev.config.mts", import.meta.url)),
    pages,
    env: { CLAUDE_USAGE_GOAL_STORE: join(storeDir, "lab.sqlite"), CLAUDE_USAGE_GOAL_SETUP: setupFile, ...patchEnv },
    timeoutMs: 180_000,
  });
  say(`Lab at ${served.origin}`);

  const failures: string[] = [];
  const notes: string[] = [];

  /** The usage query, over the Lab's HTTP door, as `person`. */
  const query = async (person: LabUser, refresh: boolean): Promise<Row[]> => {
    const done = await labRoutes(served.origin, person).act(PROJECTS_FLOW, `${PROJECTS_FLOW}-own-${person.userId}`, "harnessUsage", refresh ? { refresh: true } : {});
    if (done.status !== "completed") throw new Error(`harnessUsage as ${person.userId} ended ${done.status}: ${done.error ?? ""}`);
    return (done.output as { harnesses: Row[] }).harnesses;
  };
  const claudeRow = (rows: Row[]) => rows.find((row) => row.harness === "claude-code");

  /** Ask the Shift Coordinator, as `person`, for a task tagged `tag`, and wait for the coder's run to end. */
  const runTask = async (person: LabUser, tag: string, until: (task: Record<string, any>) => boolean = ended) => {
    const routes = labRoutes(served.origin, person);
    const sessionId = `s-shift-coordinator-${tag}-${RUN_STAMP}`;
    const created = await routes.call("POST", "/coordinator/sessions", { userId: person.userId, sessionId, state: { workerId: "shift-coordinator" } });
    if (created.status !== 201) throw new Error(`${tag}: opening the Shift Coordinator's session answered ${created.status} ${JSON.stringify(created.body)}`);
    const said = await routes.act("coordinator", sessionId, "respond", { message: `Please take this on. [[usage:${tag}]]` });
    if (said.status !== "completed") throw new Error(`${tag}: the Shift Coordinator's turn ended ${said.status}: ${said.error ?? ""}`);
    for (const deadline = Date.now() + 120_000; Date.now() < deadline; await sleep(300)) {
      const listed = await routes.act("coordinator", sessionId, LIST_TASKS_ACTION, {});
      const task = (listed.output as { tasks?: Array<Record<string, any>> } | undefined)?.tasks?.[0];
      if (task !== undefined && until(task)) return task;
    }
    throw new Error(`${tag}: the coder's task never ended`);
  };
  /** File a task and return once its run has started, without waiting for it to end. */
  const startTask = (person: LabUser, tag: string) => runTask(person, tag, (task) => task.status !== "pending" || started_(tag).length > 0);

  const browser = await launchChromium();
  /** The Claude Code card on Usage, as `person` sees it. */
  const view = async (person: LabUser, owner: boolean) => {
    const { context, page } = await personPage(browser, served.origin, person, owner);
    try {
      await openShiftManager(page, served.origin, "/usage");
      await page.locator("[data-testid=usage-harness][data-harness=claude-code]").waitFor({ timeout: 30_000 });
      return await page.$eval("[data-testid=usage-harness][data-harness=claude-code]", (card) => ({
        status: card.getAttribute("data-status"),
        text: card.textContent ?? "",
        windows: [...card.querySelectorAll("[data-testid=usage-window]")].map((w) => ({
          id: w.getAttribute("data-window-id"),
          text: w.textContent ?? "",
          percent: w.querySelector("[data-testid=usage-percent]")?.textContent ?? null,
          level: w.querySelector("[data-testid=usage-level]")?.textContent ?? null,
          reset: w.querySelector("[data-testid=usage-reset]")?.textContent ?? null,
          age: w.querySelector("[data-testid=usage-window-age]")?.textContent ?? null,
        })),
      }));
    } finally {
      await context.close();
    }
  };

  try {
    // ── Legs a, b, c: one run each, then the query and the view. ────────────
    // Token-only sign-ins (no account named), so the view's look keeps the run's window.
    script("a", [{ info: event.allowed() }]);
    script("b", [{ info: event.warning(0.91) }]);
    script("c", [{ info: event.rejected() }]);
    signIn({ tokenSource: "CLAUDE_CODE_OAUTH_TOKEN" });
    for (const leg of ["a", "b", "c"] as const) {
      const task = await runTask(PEOPLE[leg], leg);
      if (task.status !== "completed") failures.push(`${leg}:run — the run ended ${task.status}: ${task.error ?? ""}`);
    }

    const a = claudeRow(await query(PEOPLE.a, false));
    const aWindow = a?.windows[0];
    if (a?.windows.length !== 1 || aWindow?.id !== "five_hour" || aWindow.level !== "ok" || aWindow.origin !== "run") failures.push(`a:window — the query returned ${JSON.stringify(a)}`);
    if (aWindow !== undefined && aWindow.usedPercent !== null) failures.push(`a:no-number — an event with no percent reads ${aWindow.usedPercent}`);
    if (aWindow !== undefined && aWindow.resetsAt !== RESETS * 1000) failures.push(`a:resets-in-ms — resetsAt ${aWindow.resetsAt}, not ${RESETS * 1000}`);
    const aView = await view(PEOPLE.a, false);
    const aShown = aView.windows[0];
    if (aShown === undefined || aShown.text.includes("%")) failures.push(`a:no-number — the view shows "${aShown?.text}"`);
    else {
      if (!aShown.level?.includes("under Claude Code's warning line")) failures.push(`a:view-level — the view says "${aShown.text}"`);
      if (aShown.reset === null) failures.push(`a:view-reset — the view shows no reset: "${aShown.text}"`);
      if (aShown.age === null || !aShown.age.includes("from a run")) failures.push(`a:view-source — the view doesn't say where the window came from: "${aShown.text}"`);
    }
    notes.push(`a: ${JSON.stringify(aWindow)}; view "${aShown?.text ?? aView.text}"`);

    const b = claudeRow(await query(PEOPLE.b, false))?.windows[0];
    if (b?.usedPercent !== 91 || b.level !== "warning") failures.push(`b:91 — the query returned ${JSON.stringify(b)}`);
    const bShown = (await view(PEOPLE.b, false)).windows[0];
    if (bShown?.percent !== "91% used") failures.push(`b:91 — the view shows "${bShown?.text}"`);
    notes.push(`b: ${b?.usedPercent} ${b?.level}; view "${bShown?.text}"`);

    const c = claudeRow(await query(PEOPLE.c, false))?.windows[0];
    if (c?.level !== "reached" || c.usedPercent !== null) failures.push(`c:reached — the query returned ${JSON.stringify(c)}`);
    const cShown = (await view(PEOPLE.c, false)).windows[0];
    if (cShown?.level !== "limit reached" || cShown.reset === null || cShown.text.includes("%")) failures.push(`c:reached — the view shows "${cShown?.text}"`);
    notes.push(`c: ${c?.level}; view "${cShown?.text}"`);

    // ── Leg d: only the run owner's row, on a run and on a talk. ────────────
    script("d-bob", [{ info: event.apiKey() }]);
    script("d-alice", [{ info: event.allowed() }], { email: "alice@goal.test" });
    script("d-bob-talk", [{ info: event.warning(0.5) }], { email: "bob@goal.test" });
    const bobTask = await runTask(PEOPLE.bob, "d-bob");
    await runTask(PEOPLE.alice, "d-alice");
    const aliceRow = claudeRow(await query(PEOPLE.alice, false));
    if (aliceRow?.windows.length !== 1) failures.push(`d:owner-row — Alice's run left her row ${JSON.stringify(aliceRow)}`);
    const bobBefore = claudeRow(await query(PEOPLE.bob, false));
    if ((bobBefore?.windows.length ?? 0) > 0) failures.push(`d:no-claude-window — Alice's run wrote Bob's row: ${JSON.stringify(bobBefore)}`);
    const runSession = bobTask.run?.sessionId as string | undefined;
    if (runSession === undefined) failures.push(`d:talk — Bob's finished task names no session: ${JSON.stringify(bobTask)}`);
    else {
      const talked = await labRoutes(served.origin, PEOPLE.bob).act(CODER_FLOW, runSession, "respond", { message: "How did it go? [[usage:d-bob-talk]]" });
      if (talked.status !== "completed") failures.push(`d:talk — Bob's talk ended ${talked.status}: ${talked.error ?? ""}`);
      if (started_("d-bob-talk").length !== 1) failures.push(`d:talk — the talk reached the harness ${started_("d-bob-talk").length} times`);
      const bobAfter = claudeRow(await query(PEOPLE.bob, false));
      const aliceAfter = claudeRow(await query(PEOPLE.alice, false));
      if (bobAfter?.windows[0]?.usedPercent !== 50) failures.push(`d:talk-writes-bob — after Bob's talk his row is ${JSON.stringify(bobAfter)}`);
      if (JSON.stringify(aliceAfter?.windows.map((w) => [w.id, w.usedPercent, w.checkedAt])) !== JSON.stringify(aliceRow?.windows.map((w) => [w.id, w.usedPercent, w.checkedAt]))) {
        failures.push(`d:talk-leaves-alice — Bob's talk changed Alice's row: ${JSON.stringify(aliceAfter)}`);
      }
      notes.push(`d: Alice ${JSON.stringify(aliceRow?.windows.map((w) => [w.id, w.level]))}; Bob before ${bobBefore?.windows.length ?? 0} window(s), after his talk ${JSON.stringify(bobAfter?.windows.map((w) => [w.id, w.usedPercent]))}`);
    }

    // ── Leg e: a look on the same sign-in keeps the run's window; another account's run clears it. ──
    script("e", [{ info: event.allowed() }], { email: "e@goal.test" });
    await runTask(PEOPLE.e, "e");
    signIn({ email: "e@goal.test", subscriptionType: "max" });
    const eLookedAt = Date.now();
    const eKept = claudeRow(await query(PEOPLE.e, true));
    if (eKept?.windows.length !== 1 || eKept.windows[0]!.origin !== "run") failures.push(`e:keeps-the-runs-window — after a look on the same sign-in the row is ${JSON.stringify(eKept)}`);
    if (eKept?.plan !== "max") failures.push(`e:adds-the-plan — the look's plan is ${eKept?.plan}`);
    notes.push(`e: after a look ${JSON.stringify(eKept?.windows.map((w) => [w.id, w.origin]))}, plan ${eKept?.plan}`);

    script("e-switch-a", [{ info: event.allowed() }, { info: event.warning(0.8, "seven_day") }], { email: "a@goal.test" });
    script("e-switch-b", [{ info: event.allowed() }], { email: "b@goal.test" });
    await runTask(PEOPLE.eSwitch, "e-switch-a");
    await runTask(PEOPLE.eSwitch, "e-switch-b");
    const switched = claudeRow(await query(PEOPLE.eSwitch, false));
    if (JSON.stringify(switched?.windows.map((w) => [w.id, w.usedPercent])) !== JSON.stringify([["five_hour", null]])) {
      failures.push(`e:switch-clears — after account B's run the row still holds ${JSON.stringify(switched?.windows)}`);
    }
    notes.push(`e: account A then B, ${JSON.stringify(switched?.windows.map((w) => [w.id, w.usedPercent]))}`);

    realProbe();
    const empty = claudeRow(await query(PEOPLE.eEmpty, true));
    if (empty?.status !== "signed-out" || empty.windows.length > 0) failures.push(`e:signed-out — the real probe on an empty home gave ${JSON.stringify(empty)}`);
    notes.push(`e: empty home "${empty?.status}" "${empty?.reason}"`);

    // ── Leg f: order, an old run, and a write that throws. ──────────────────
    // Two runs at once, one person: account A's event is observed first and
    // written last (its run's account answers slowly), after account B's.
    const goB = join(SCRATCH, "f-b-go");
    script("f-a", [{ info: event.warning(0.8) }], { email: "a@goal.test" }, 4_000);
    script("f-b", [{ info: event.allowed(), waitFor: goB }], { email: "b@goal.test" });
    const fa = runTask(PEOPLE.fOrder, "f-a");
    const fb = runTask(PEOPLE.fOrder, "f-b");
    for (const until = Date.now() + 60_000; (started_("f-a").length === 0 || started_("f-b").length === 0) && Date.now() < until; ) await sleep(100);
    const [faStart] = started_("f-a");
    const [fbStart] = started_("f-b");
    await sleep(300);
    writeFileSync(goB, "");
    await Promise.all([fa, fb]);
    if (faStart === undefined || fbStart === undefined || Math.abs(fbStart - faStart) > 3_000) {
      failures.push(`f:setup — the two runs didn't overlap (started ${faStart}, ${fbStart}), so the order isn't tested`);
    }
    const ordered = claudeRow(await query(PEOPLE.fOrder, false));
    if (ordered?.windows.length !== 1 || ordered.windows[0]!.level !== "ok" || ordered.windows[0]!.usedPercent !== null) {
      failures.push(`f:newer-kept — account A's older event, written after account B's, left ${JSON.stringify(ordered?.windows)}`);
    }
    notes.push(`f: A started ${faStart}, B ${fbStart}; row ${JSON.stringify(ordered?.windows.map((w) => [w.id, w.level, w.usedPercent]))}`);

    // A run that started before a look found an API key.
    const go = join(SCRATCH, "f-old-go");
    script("f-old", [{ info: event.warning(0.7), waitFor: go }], { email: "old@goal.test" });
    const old = startTask(PEOPLE.fOld, "f-old");
    for (const until = Date.now() + 60_000; started_("f-old").length === 0 && Date.now() < until; ) await sleep(200);
    realProbe("sk-ant-goal-not-a-real-key");
    const keyed = claudeRow(await query(PEOPLE.fOld, true));
    writeFileSync(go, "");
    await old;
    for (const until = Date.now() + 60_000; Date.now() < until; await sleep(300)) {
      const listed = readFileSync(runLog, "utf8");
      if (listed.includes("RUN f-old")) break;
    }
    await sleep(2_000);
    const afterOld = claudeRow(await query(PEOPLE.fOld, false));
    if (keyed?.status !== "api-key") failures.push(`f:setup — the look on an API key gave ${JSON.stringify(keyed)}`);
    if (afterOld?.status !== "api-key" || afterOld.windows.length > 0) failures.push(`f:old-run — a run from before the look brought windows back: ${JSON.stringify(afterOld)}`);
    notes.push(`f: old run after an API-key look, ${afterOld?.status} with ${afterOld?.windows.length} window(s)`);

    // A usage write that throws: the run still completes, and nothing is written.
    script("f-throws", [{ info: event.allowed("goal_write_throws") }]);
    const cBefore = claudeRow(await query(PEOPLE.c, false));
    const thrown = await runTask(PEOPLE.c, "f-throws");
    if (thrown.status !== "completed") failures.push(`f:write-throws — the run ended ${thrown.status}: ${thrown.error ?? ""}`);
    const cAfter = claudeRow(await query(PEOPLE.c, false));
    if (JSON.stringify(cAfter?.windows) !== JSON.stringify(cBefore?.windows.map((w) => ({ ...w, ageMs: cAfter?.windows.find((x) => x.id === w.id)?.ageMs ?? w.ageMs })))) {
      failures.push(`f:write-throws — the failed write changed the row: ${JSON.stringify(cAfter?.windows)}`);
    }
    notes.push(`f: the throwing write's run ${thrown.status}`);

    // ── Leg e, second half: a minute after the look, the same person moves to an API key. ──
    const wait = eLookedAt + 61_000 - Date.now();
    if (wait > 0) {
      say(`e: waiting ${Math.ceil(wait / 1000)} s for the minute to pass`);
      await sleep(wait);
    }
    realProbe("sk-ant-goal-not-a-real-key");
    const eKey = claudeRow(await query(PEOPLE.e, true));
    if (eKey?.status !== "api-key" || eKey.windows.length > 0 || eKey.reason !== "Claude Code uses an API key: no subscription limit") {
      failures.push(`e:api-key — after a move to an API key the row is ${JSON.stringify(eKey)}`);
    }
    notes.push(`e: then on an API key, "${eKey?.status}" "${eKey?.reason}"`);
  } finally {
    await browser.close();
    await served.stop();
    writeFileSync(join(SCRATCH, "lab.log"), served.log());
  }

  assertPatched(patches, REPO_ROOT, mark);
  if (process.env.GOAL_KEEP_STORE === undefined) rmSync(storeDir, { recursive: true, force: true });
  for (const note of notes) say(note);
  say("g: owed by a person — Jake's own Claude sign-in, a real run, then Usage beside Claude Code's /status");

  if (control !== undefined) {
    const red = control.assertions.filter((name) => failures.some((f) => f.startsWith(`${name} `)));
    const missed = control.assertions.filter((name) => !red.includes(name));
    failures.unshift(
      missed.length === 0
        ? `control ${control.name}: failed on ${red.join(", ")}, as it must`
        : `control ${control.name}: did NOT fail on ${missed.join(", ")}, so the check can't see what the control removes`,
    );
  }
  return {
    failures,
    evidence: `legs a, b, c, d, e, f PASS in ${Math.round((Date.now() - started) / 1000)} s (leg g owed by a person: goal met except leg g)`,
  };
});

function ended(task: Record<string, any>): boolean {
  return ["completed", "errored", "failed", "cancelled"].includes(String(task.status));
}
