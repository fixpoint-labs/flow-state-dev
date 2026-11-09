/** What this run proves is `goal.md` beside this file. */
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { createScheduledTransportAdapter, formatScheduleId } from "@flow-state-dev/scheduled";
import { inMemoryStores } from "@flow-state-dev/engine";
import { REPO_ROOT, goalTmpDir, loadFixture, runGoal } from "../../lib/index.mts";
import { assertPatched, describePatches, modulePatchEnv, type ModulePatch } from "../../lib/module-patch.mts";
import { ORG } from "../../../packages/workforce/test/conversation-board-harness.ts";
import { bootSubscriptionsHost, event, github, revoked, type SubscriptionsHost } from "../../../packages/workforce/test/subscriptions-harness.ts";
import { deriveWorkerSessionId } from "../../../packages/workforce/src/workers/derive-session-id.ts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const SCRATCH = process.env.GOAL_SCRATCH ?? goalTmpDir("routines-one-list");
const ROUTINES = "packages/workforce/src/routines/routines.ts";

/** The controls: each degrades one behaviour in the code under test, as it loads. */
const PATCHES: Record<string, ModulePatch[]> = {
  // The list reads the schedule collection only: no event routine lists.
  "schedules-only": [{ module: ROUTINES, from: String.raw`\.filter\(\(row\) => row\.enabled \|\| isPaused\(row\)\)\.map\(listedEvent\)`, to: ".filter(() => false).map(listedEvent)" }],
  // A pause turns the row off and leaves it in the thread index.
  "pause-keeps-index": [
    { module: "packages/workforce/src/subscriptions/subscribe.ts", from: String.raw`await dropFromIndex\(ctx, outcome\?\.thread \?\? ref\.state\.thread, id\);`, to: 'if (reason !== "paused") await dropFromIndex(ctx, outcome?.thread ?? ref.state.thread, id);' }
  ],
  // A seed writes every declared routine on, whatever the person paused.
  "seed-unpauses": [
    { module: ROUTINES, from: String.raw`enabled: existing\?\.enabled \?\? true`, to: "enabled: true" },
    { module: ROUTINES, from: String.raw`await seedSubscription\(ctx, `, to: "await subscribe(ctx, " }
  ],
  // A resume subscribes again without the row's task.
  "resume-drops-task": [{ module: ROUTINES, from: String.raw`\.\.\.\(row\.taskId === undefined \? \{\} : \{ taskId: row\.taskId \}\)`, to: "...{}" }]
};

if (CONTROL !== "" && PATCHES[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(PATCHES).join(", ")}`);
  process.exit(2);
}
// A control runs this same file again with its patch applied as it loads.
if (PATCHES[CONTROL] !== undefined && process.env.GOAL_MODULE_PATCH === undefined) {
  const mark = join(SCRATCH, `patch-mark-${CONTROL}`);
  rmSync(mark, { force: true });
  console.error(`control ${CONTROL}:\n${describePatches(PATCHES[CONTROL]!, REPO_ROOT)}`);
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, GOAL_SCRATCH: SCRATCH, ...modulePatchEnv(PATCHES[CONTROL]!, REPO_ROOT, mark) }
  });
  assertPatched(PATCHES[CONTROL]!, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}

// ---- the fixture ------------------------------------------------------------

type Declared = { id: string; trigger: any; task?: any; worker?: string };
type Fixture = {
  a: string;
  b: string;
  clock: { name: string; cron: string; timezone: string; task: Record<string, unknown> };
  workerClock: { name: string; cron: string; task: Record<string, unknown> };
  personThread: string;
  workerThread: string;
  taskThread: string;
  privateThread: string;
  legacy: { key: string; cron: string; thread: string };
  declared: Declared[];
  changed: { clockCron: string; eventInterest: string };
};
const F = loadFixture<Fixture>(import.meta.url, "routines.json");
const A = F.a;
const B = F.b;

/** The latest time a weekly UTC cron `m h * * dow` was due, worked out here, not by the code under test. */
function lastWeekly(cron: string): string {
  const [minute, hour, , , dow] = cron.split(" ").map(Number) as [number, number, number, number, number];
  const now = new Date();
  const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute));
  while (at.getUTCDay() !== dow || at.getTime() > now.getTime()) at.setUTCDate(at.getUTCDate() - 1);
  return at.toISOString();
}

// ---- the host ---------------------------------------------------------------

type Listed = { id: string; name: string; worker: string; paused: boolean; madeBy?: { by: string; entry?: string }; trigger: any };

function boot(declared: Declared[], stores: ReturnType<typeof inMemoryStores>, hold?: Promise<void>) {
  return bootSubscriptionsHost({
    // The harness types its stores from the engine source; this file imports the built package.
    stores: stores as never,
    adapters: [createScheduledTransportAdapter()],
    hire: { routines: { providers: [github], declared: declared as never } },
    ...(hold === undefined ? {} : { hold })
  });
}

const roster = async (h: SubscriptionsHost, user: string, action: string, input: unknown) => {
  const ran = await h.act(user, `roster-${user}`, action, input, "roster");
  if (ran.error !== undefined) throw new Error(`setup: ${action} failed: ${JSON.stringify(ran.error)}`);
  return ran.output as any;
};
const listOf = async (h: SubscriptionsHost, user: string) => ((await roster(h, user, "listRoutines", {})) as { routines: Listed[] }).routines;
const saved = (out: any, what: string): Listed => {
  if (out?.ok !== true) throw new Error(`setup: ${what} was refused: ${out?.error ?? JSON.stringify(out)}`);
  return out.routine as Listed;
};

/** POST a clock routine's dispatch as a host's cron does, for its latest due time. */
async function fire(h: SubscriptionsHost, user: string, key: string, cron: string) {
  const id = formatScheduleId(ORG, user, key);
  const response = await (await h.router()).POST(
    new Request(`http://localhost/api/flows/workforce-roster/schedules/${encodeURIComponent(id)}/dispatch`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user": "scheduler" },
      body: JSON.stringify({ nominalFireTime: lastWeekly(cron) })
    }),
    { params: { path: ["workforce-roster", "schedules", id, "dispatch"] } }
  );
  await h.settled();
  return response.status;
}

/** An event on `thread`, as an ingestion would route it. */
const on = (thread: string, text: string, fields: Record<string, unknown> = {}) =>
  event({ threads: [thread.split("#")[0]!, thread], text, url: `https://github.com/${thread.slice("github:".length)}`, ...fields });

/** The subscription ids the org's thread index names for `thread`, read from the store. */
async function indexed(h: SubscriptionsHost, thread: string): Promise<string[]> {
  const runtime = await h.state.getRuntime();
  const row = await runtime.stores.resourceState.get("org", ORG, `workforce/subscription-index/${encodeURIComponent(thread)}`);
  return Object.keys((row?.state as { subscriptions?: Record<string, unknown> } | undefined)?.subscriptions ?? {});
}

/** A user's stored routines, both collections, read from the store: live or paused. */
async function storedIds(h: SubscriptionsHost, user: string): Promise<string[]> {
  const runtime = await h.state.getRuntime();
  const cell = `${user}:~org:${ORG}`;
  const clocks = await runtime.stores.resourceState.getByPrefix("user", cell, "workforce/schedules/");
  const subs = await runtime.stores.resourceState.getByPrefix("user", cell, "workforce/subscriptions/");
  return [
    ...Object.keys(clocks).map((k) => `clock:${k.slice("workforce/schedules/".length)}`),
    ...Object.values(subs)
      .map((v) => v.state as { id: string; enabled: boolean; endedReason?: string })
      .filter((r) => r.enabled || r.endedReason === "paused")
      .map((r) => `event:${r.id}`)
  ].sort();
}

const tasksRun = (h: SubscriptionsHost) => h.runs.filter((run) => run.worker === "eng.tasker").length;
const conversation = (user: string) => deriveWorkerSessionId({ userId: user, orgId: ORG, flow: "follower", criteria: { worker: "eng.follower" } });

// ---- the run ----------------------------------------------------------------

await runGoal(async (failures, tell) => {
  const stores = inMemoryStores();
  let releaseTask!: () => void;
  const h = boot(F.declared, stores, new Promise<void>((resolve) => (releaseTask = resolve)));
  const evidence: string[] = [];
  try {
    // ---- the four writers ----
    const made: string[] = [];
    made.push(saved(await roster(h, A, "saveRoutine", { name: F.clock.name, trigger: { clock: { cron: F.clock.cron, timezone: F.clock.timezone } }, task: F.clock.task }), "the roster's clock save").id);
    const personEvent = saved(await roster(h, A, "saveRoutine", { trigger: { event: { provider: "github", thread: F.personThread, interest: "reviews" } }, worker: "eng.follower" }), "the roster's event save");
    made.push(personEvent.id);
    const privateEvent = saved(await roster(h, A, "saveRoutine", { trigger: { event: { provider: "github", thread: F.privateThread, interest: "private" } }, worker: "eng.follower" }), "the private save");
    made.push(privateEvent.id);
    const chat = await h.follower(A);
    made.push(saved((await h.act(A, chat, "saveRoutine", { trigger: { event: { provider: "github", thread: F.workerThread, interest: "CI" } } }, "follower")).output, "the worker's event save").id);
    made.push(saved((await h.act(A, chat, "saveRoutine", { name: F.workerClock.name, trigger: { clock: { cron: F.workerClock.cron } }, task: F.workerClock.task }, "follower")).output, "the worker's clock save").id);
    // A task subscribes when it opens its PR; it waits on its hold, then fails.
    const lead = await h.conversation(A, "lead");
    const filed = await h.act(A, lead, "createTask_tasks", { goal: `open the PR [subscribe:${F.taskThread}] [hold] [fail]`, assignee: "eng.follower" });
    if (filed.error !== undefined) throw new Error(`setup: filing the task failed: ${JSON.stringify(filed.error)}`);
    let taskRow: { id: string; taskId?: string } | undefined;
    for (let i = 0; i < 500 && taskRow === undefined; i += 1) {
      taskRow = (await h.subscriptionRows(A)).find((r) => r.thread === F.taskThread) as typeof taskRow;
      if (taskRow === undefined) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (taskRow === undefined) throw new Error("setup: the task never subscribed");
    made.push(`event:${taskRow.id}`);
    // Rows as `main`'s code wrote them: a schedule with no maker, a subscription with no maker.
    const runtime = await h.state.getRuntime();
    const cellA = `${A}:~org:${ORG}`;
    await runtime.stores.resourceState.set("user", cellA, `workforce/schedules/${F.legacy.key}`, { cron: F.legacy.cron, kind: "task", input: F.clock.task, enabled: true, orgId: ORG } as never, "any");
    made.push(`clock:${F.legacy.key}`);
    const legacySub = (await h.subscribe(A, chat, { thread: F.legacy.thread })) as { id: string };
    const legacyKey = `workforce/subscriptions/${legacySub.id}`;
    const legacyRow = (await runtime.stores.resourceState.get("user", cellA, legacyKey))!.state as Record<string, unknown>;
    const { madeBy: _drop, ...asMain } = legacyRow;
    await runtime.stores.resourceState.set("user", cellA, legacyKey, asMain as never, "any");
    made.push(`event:${legacySub.id}`);

    // ---- (a) one list, (e) B sees none of A's ----
    const listed = await listOf(h, A);
    tell.over("a · A's listed routines", listed);
    const listedIds = listed.map((r) => r.id).sort();
    const appMade = listed.filter((r) => r.madeBy?.by === "app");
    const wanted = [...made].sort();
    const missing = wanted.filter((id) => !listedIds.includes(id));
    if (missing.length > 0) failures.push(`a:every-writer — A's list misses ${missing.join(", ")} (listed ${listedIds.join(", ")})`);
    if (appMade.length !== F.declared.length) failures.push(`a:the-seed — ${appMade.length} app routines listed, wanted ${F.declared.length}`);
    const stored = await storedIds(h, A);
    if (JSON.stringify(stored) !== JSON.stringify(listedIds)) failures.push(`a:equals-the-store — list ${listedIds.join(", ")} vs stored ${stored.join(", ")}`);
    const legacyListed = listed.filter((r) => r.id === `clock:${F.legacy.key}` || r.id === `event:${legacySub.id}`);
    if (legacyListed.length !== 2 || legacyListed.some((r) => r.madeBy !== undefined)) failures.push(`g:lists — ${JSON.stringify(legacyListed)}`);
    const bList = await listOf(h, B);
    if (bList.some((r) => made.includes(r.id))) failures.push(`e:b-sees-none — B lists ${bList.filter((r) => made.includes(r.id)).map((r) => r.id).join(", ")}`);
    evidence.push(`a: ${listedIds.length} listed = stored, ${made.length} from writers + ${appMade.length} seeded; e: B lists ${bList.length} (its own seeds)`);

    // ---- (h) a task's routine, paused then resumed, ends with its task ----
    const taskId = `event:${taskRow.id}`;
    saved(await roster(h, A, "pauseRoutine", { id: taskId, paused: true }), "pausing the task's routine");
    saved(await roster(h, A, "pauseRoutine", { id: taskId, paused: false }), "resuming the task's routine");
    // The resumed row still names its task, before the task's own turn could write it again: a
    // failed task's retry subscribes afresh, so the ending alone can't tell a dropped task apart.
    const resumed = (await h.subscriptionRows(A)).find((r) => r.id === taskRow!.id);
    if (resumed?.enabled !== true || resumed.taskId !== taskRow.taskId) {
      failures.push(`h:keeps-its-task — the resumed row is ${JSON.stringify({ enabled: resumed?.enabled, taskId: resumed?.taskId })}, wanted on with task ${taskRow.taskId}`);
    }
    releaseTask();
    await h.settled();
    const ended = (await h.subscriptionRows(A)).find((r) => r.id === taskRow!.id);
    if (ended?.enabled !== false || ended.endedReason !== "task_errored") failures.push(`h:ends-with-its-task — after the task failed the row is ${JSON.stringify({ enabled: ended?.enabled, endedReason: ended?.endedReason })}`);

    // ---- (g) main's rows fire ----
    const firedLegacy = await fire(h, A, F.legacy.key, F.legacy.cron);
    if (tasksRun(h) !== 1) failures.push(`g:fires — the legacy schedule answered ${firedLegacy} and ran ${tasksRun(h)} tasks`);
    await h.route(on(F.legacy.thread, "legacy review"));
    if (!(await h.heard(chat)).some((m) => m.includes("legacy review"))) failures.push("g:delivers — the legacy subscription delivered nothing");

    // ---- (b) paused fires nothing ----
    const clockId = `clock:${F.clock.name}`;
    saved(await roster(h, A, "pauseRoutine", { id: clockId, paused: true }), "pausing the clock");
    saved(await roster(h, A, "pauseRoutine", { id: personEvent.id, paused: true }), "pausing the event");
    saved(await roster(h, A, "pauseRoutine", { id: privateEvent.id, paused: true }), "pausing the private event");
    const before = tasksRun(h);
    await fire(h, A, F.clock.name, F.clock.cron);
    if (tasksRun(h) !== before) failures.push(`b:clock-files-nothing — a paused clock routine ran ${tasksRun(h) - before} tasks`);
    const hearer = await conversation(A);
    // Before any event: delivery heals a stale entry, and the claim is that the pause took it out.
    const personSub = personEvent.id.slice("event:".length);
    if ((await indexed(h, F.personThread)).includes(personSub)) failures.push("b:out-of-the-index — the paused routine is still in the thread index");
    await h.route(on(F.personThread, "while paused"));
    if ((await h.heard(hearer)).some((m) => m.includes("while paused"))) failures.push("b:event-delivers-nothing — a paused event routine delivered");

    // ---- (c) resumed fires again; a resume re-checks read access ----
    saved(await roster(h, A, "pauseRoutine", { id: clockId, paused: false }), "resuming the clock");
    saved(await roster(h, A, "pauseRoutine", { id: personEvent.id, paused: false }), "resuming the event");
    const resumedStatus = await fire(h, A, F.clock.name, F.clock.cron);
    if (tasksRun(h) !== before + 1) failures.push(`c:clock-fires — the resumed clock routine answered ${resumedStatus} and ran ${tasksRun(h) - before} tasks`);
    await h.route(on(F.personThread, "after resume"));
    if (!(await h.heard(hearer)).some((m) => m.includes("after resume"))) failures.push("c:event-delivers — the resumed event routine delivered nothing");
    revoked.add(A);
    const refused = await roster(h, A, "pauseRoutine", { id: privateEvent.id, paused: false });
    revoked.delete(A);
    if (refused?.ok !== false || !/^not_readable/.test(String(refused.error))) failures.push(`c:read-rechecked — resuming without read access answered ${JSON.stringify(refused)}`);
    if ((await indexed(h, F.privateThread)).length !== 0) failures.push("c:read-rechecked — the refused resume reached the thread index");

    // ---- (d) deleted: not listed, nothing fires ----
    await roster(h, A, "deleteRoutine", { id: clockId });
    await roster(h, A, "deleteRoutine", { id: personEvent.id });
    const afterDelete = (await listOf(h, A)).map((r) => r.id);
    if (afterDelete.includes(clockId) || afterDelete.includes(personEvent.id)) failures.push(`d:not-listed — ${afterDelete.join(", ")}`);
    const runsBefore = tasksRun(h);
    await fire(h, A, F.clock.name, F.clock.cron);
    await h.route(on(F.personThread, "after delete"));
    if (tasksRun(h) !== runsBefore) failures.push("d:nothing-fires — the deleted clock routine ran a task");
    if ((await h.heard(hearer)).some((m) => m.includes("after delete"))) failures.push("d:nothing-fires — the deleted event routine delivered");
    evidence.push("b–d, h: paused fired nothing and left the index; resumed fired; resume without read refused; task routine ended task_errored after pause and resume; deleted fired nothing");

    // ---- (f) seeded twice: one routine; a change reaches the row and keeps its pause ----
    for (const r of (await listOf(h, A)).filter((r) => r.madeBy?.by === "app")) {
      saved(await roster(h, A, "pauseRoutine", { id: r.id, paused: true }), `pausing ${r.id}`);
    }
  } finally {
    await h.dispose();
  }

  const changed: Declared[] = JSON.parse(JSON.stringify(F.declared));
  for (const entry of changed) {
    if ("clock" in entry.trigger) entry.trigger.clock.cron = F.changed.clockCron;
    else entry.trigger.event.interest = F.changed.eventInterest;
  }
  // Two restarts over the same store: the same config, then a changed one.
  for (const [round, declared] of [["same", F.declared], ["changed", changed]] as const) {
    const again = boot(declared, stores);
    try {
      const seeded = (await listOf(again, A)).filter((r) => r.madeBy?.by === "app");
      tell.over(`f · seeded (${round})`, seeded);
      if (seeded.length !== F.declared.length) failures.push(`f:once — after the ${round} restart A lists ${seeded.length} app routines, wanted ${F.declared.length}`);
      if (seeded.some((r) => !r.paused)) failures.push(`f:keeps-the-pause — after the ${round} restart ${seeded.filter((r) => !r.paused).map((r) => r.id).join(", ")} is on`);
      if (round === "changed") {
        const clock = seeded.find((r) => "clock" in r.trigger);
        const ev = seeded.find((r) => "event" in r.trigger);
        if (clock?.trigger.clock.cron !== F.changed.clockCron) failures.push(`f:change-reaches-the-row — the clock routine's cron is ${clock?.trigger.clock.cron}`);
        if (ev?.trigger.event.interest !== F.changed.eventInterest) failures.push(`f:change-reaches-the-row — the event routine's interest is ${ev?.trigger.event.interest}`);
        const thread = (F.declared.find((d) => "event" in d.trigger)!.trigger as { event: { thread: string } }).event.thread;
        if ((await indexed(again, thread)).length !== 0) failures.push("f:keeps-the-pause — the paused seeded event routine is back in the thread index");
      }
    } finally {
      await again.dispose();
    }
  }
  evidence.push("f: two restarts, one row per entry, paused kept, the changed cron and interest reached the rows");
  return { failures, evidence: evidence.join("; ") };
});
