/**
 * Goal check — Alice's recurring work arrives as an ordinary task on the board
 * she named, once per scheduled time across restarts and hosts, and she can see
 * every schedule's next run (FIX-2085). See goal.md.
 *
 * Every step is a real process of one Workforce app over one SQLite file
 * (`host.mts`), its clock pinned to the moment the step stands at. Two steps run
 * at once, as two hosts behind one cron. What is graded is what Alice reads
 * (her task list through the public task read, her schedule list) and the
 * requests launch's conversation ran, never the dispatch answers alone.
 *
 * Legs:
 *   a  a fire, POSTed as a host's cron does, files one task on launch's board,
 *      assigned to researcher; it runs; launch's conversation runs one ending
 *      request for it. The next week's task, cancelled by Alice, ends cancelled.
 *   b  one scheduled time POSTed by two processes at once, again after a
 *      restart, and again 20 s late, files exactly one task. An untimed POST a
 *      minute before the next time files nothing; that time's own fire files.
 *   c  her list shows each schedule's next run, equal to its cron in its time
 *      zone; one removed and one added show on the next read. No schedule index.
 *
 * The expected scheduled times and next runs are worked out here by stepping
 * minutes through the zone's wall clock (`Intl`), not with the library the
 * implementation uses.
 *
 * Run:      pnpm tsx goals/scheduled-work/recurring-work-files-a-task/run.mts
 * Control:  GOAL_CONTROL=memory-dedupe (must FAIL b:exactly-one-task)
 */
import { onClosed } from "../../lib/server.mts";
import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REPO_ROOT,
  RUN_STAMP,
  assertPatched,
  describePatches,
  goalTmpDir,
  loadFixture,
  modulePatchEnv,
  runGoal,
  type ModulePatch
} from "../../lib/index.mts";

type Schedule = { key: string; cron: string; timezone: string; goal: string };
type Fixture = { org: string; user: string; filer: string; assignee: string; start: string; weekly: Schedule; listed: Schedule[] };
type Task = { id: string; goal: string; assignee?: string; status: string };

const fixture = loadFixture<Fixture>(import.meta.url, "schedules.json");
const HERE = fileURLToPath(new URL(".", import.meta.url));
const SCRATCH = goalTmpDir("scheduled-work-recurring");
const say = (s: string) => console.error(`[recurring-work] ${s}`);

// ---- the control: today's dedupe, one process's memory ------------------------
const SCHEDULED_TIME = "packages/scheduled/src/scheduledTime.ts";
const CONTROLS: Record<string, { does: string; patches: ModulePatch[] }> = {
  "memory-dedupe": {
    does: "each process decides a duplicate from its own memory, as the per-process cache did, instead of the shared store",
    patches: [
      {
        module: SCHEDULED_TIME,
        from: String.raw`const current = await store\.get\("user", address\.scopeId, address\.key\);`,
        to: "const current = (globalThis.__goalFired ??= new Map()).get(address.key);"
      },
      {
        module: SCHEDULED_TIME,
        from: String.raw`const written = await store\.set\("user", address\.scopeId, address\.key, \{ \.\.\.next \}, current\?\.version \?\? 0\);`,
        to: "const written = { ok: true, version: (current?.version ?? 0) + 1 }; globalThis.__goalFired.set(address.key, { state: { ...next }, version: written.version });"
      }
    ]
  }
};
const CONTROL = process.env.GOAL_CONTROL ?? "";
if (CONTROL !== "" && CONTROLS[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(CONTROLS).join(", ")}`);
  process.exit(2);
}
// A control runs this file again with the patch applied as each process loads.
if (CONTROL !== "" && process.env.GOAL_MODULE_PATCH === undefined) {
  const mark = join(SCRATCH, `patch-mark-${RUN_STAMP}`);
  rmSync(mark, { force: true });
  console.error(`control ${CONTROL}: ${CONTROLS[CONTROL]!.does}\n${describePatches(CONTROLS[CONTROL]!.patches, REPO_ROOT)}`);
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, ...modulePatchEnv(CONTROLS[CONTROL]!.patches, REPO_ROOT, mark) }
  });
  assertPatched(CONTROLS[CONTROL]!.patches, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}

// ---- scheduled times, from the zone's wall clock --------------------------------
/** Whether `value` is in one cron field (`*`, `n`, `a-b`, `*\/s`, `a-b/s`, lists). */
function fieldHas(field: string, value: number, low: number, high: number): boolean {
  return field.split(",").some((part) => {
    const [range, stepText] = part.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    const [from, to] = range === "*" ? [low, high] : range!.includes("-") ? range!.split("-").map(Number) : [Number(range), stepText === undefined ? Number(range) : high];
    return value >= from! && value <= to! && (value - from!) % step === 0;
  });
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Whether the minute starting at `ms` is a time of `cron` on `timezone`'s wall clock. */
function isScheduled(cron: string, timezone: string, ms: number): boolean {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", weekday: "short", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value])
  );
  const [minute, hour, dom, month, dow] = cron.trim().split(/\s+/) as [string, string, string, string, string];
  const weekday = WEEKDAYS[parts.weekday!]!;
  const dayOk =
    dom !== "*" && dow !== "*"
      ? fieldHas(dom, Number(parts.day), 1, 31) || fieldHas(dow, weekday, 0, 7) || (weekday === 0 && fieldHas(dow, 7, 0, 7))
      : fieldHas(dom, Number(parts.day), 1, 31) && (fieldHas(dow, weekday, 0, 7) || (weekday === 0 && fieldHas(dow, 7, 0, 7)));
  return fieldHas(minute, Number(parts.minute), 0, 59) && fieldHas(hour, Number(parts.hour), 0, 23) && fieldHas(month, Number(parts.month), 1, 12) && dayOk;
}

/** The first scheduled time strictly after `after`. */
function nextAfter(cron: string, timezone: string, after: number): number {
  let ms = Math.floor(after / 60_000) * 60_000 + 60_000;
  for (let i = 0; i < 60 * 24 * 400; i += 1, ms += 60_000) if (isScheduled(cron, timezone, ms)) return ms;
  throw new Error(`no time of "${cron}" in ${timezone} within a year of ${new Date(after).toISOString()}`);
}

// ---- the processes ------------------------------------------------------------
const DB = join(SCRATCH, `goal-${RUN_STAMP}.db`);
const iso = (ms: number) => new Date(ms).toISOString();

/** Run one host process standing at `now`, doing `ops`, and read what it reported. */
async function host(now: number, ops: unknown[], label: string): Promise<{ results: any[]; setup?: string }> {
  const child = spawn(process.execPath, [...process.execArgv, join(HERE, "host.mts")], {
    cwd: HERE,
    env: {
      ...process.env,
      GOAL_NOW: iso(now),
      GOAL_DB: DB,
      GOAL_ORG: fixture.org,
      GOAL_USER: fixture.user,
      GOAL_FILER: fixture.filer,
      GOAL_ASSIGNEE: fixture.assignee,
      GOAL_OPS: JSON.stringify(ops)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += String(d)));
  child.stderr.on("data", (d) => (err += String(d)));
  const code = await new Promise<number | null>((resolve) => onClosed(child, resolve));
  const line = out.split("\n").find((l) => l.startsWith("__GOAL__"));
  if (line === undefined) return { results: [], setup: `${label}: the host printed no result (exit ${code}): ${(err || out).slice(-1500)}` };
  const parsed = JSON.parse(line.slice("__GOAL__".length)) as { results: any[]; setup?: string };
  return parsed.setup === undefined ? parsed : { ...parsed, setup: `${label}: ${parsed.setup}` };
}

const save = (s: Schedule) => ({
  op: "save",
  schedule: { key: s.key, cron: s.cron, timezone: s.timezone, input: { filer: fixture.filer, goal: s.goal, assignee: fixture.assignee } }
});
const fire = (key: string, at?: number) => ({ op: "fire", key, ...(at === undefined ? {} : { at: iso(at) }) });
const of = (results: any[], op: string) => results.filter((r) => r.op === op);

await runGoal(async (failures, tell) => {
  rmSync(DB, { force: true });
  const notes: string[] = [];
  const { weekly } = fixture;
  // Four weekly times from the fixture's start, worked out from the wall clock.
  const slots: number[] = [];
  for (let at = Date.parse(fixture.start); slots.length < 4; ) slots.push((at = nextAfter(weekly.cron, weekly.timezone, at)));
  say(`times: ${slots.map(iso).join(", ")}`);
  const setup = (r: { setup?: string }) => {
    if (r.setup !== undefined) throw new Error(r.setup);
  };

  // ---- leg a: a fire files one ordinary task, which runs and is heard once ----
  const a1 = await host(slots[0]! + 2_000, [save(weekly), fire(weekly.key, slots[0]), { op: "settle" }, { op: "tasks" }, { op: "endings" }], "a1");
  setup(a1);
  const [a1Fire] = of(a1.results, "fire");
  const a1Tasks = tell.over("a · Alice's tasks after the first fire", of(a1.results, "tasks")[0]?.out as Task[]);
  if (a1Fire?.status !== 202) failures.push(`a:accepted — the first fire answered ${a1Fire?.status} ${JSON.stringify(a1Fire?.body)}`);
  if (a1Tasks.length !== 1) failures.push(`a:one-task-on-launch's-board — wanted one task in Alice's list with launch, it holds ${JSON.stringify(a1Tasks)}`);
  const first = a1Tasks[0];
  if (first !== undefined) {
    if (first.goal !== weekly.goal || first.assignee !== fixture.assignee) failures.push(`a:the-schedule's-task — wanted "${weekly.goal}" for ${fixture.assignee}, got ${JSON.stringify(first)}`);
    if (first.status !== "completed") failures.push(`a:it-runs — the task ended ${first.status}`);
    const endings = tell.over("a · launch's ending requests", of(a1.results, "endings")[0]?.out as Array<{ taskId: string; ending: string }>);
    const heard = endings.filter((e) => e.taskId === first.id);
    if (heard.length !== 1) failures.push(`a:ending-heard-once — launch's conversation ran ${heard.length} ending requests for ${first.id}: ${JSON.stringify(endings)}`);
    else notes.push(`a: one task, ${first.assignee}, ${first.status}, heard once (${heard[0]!.ending})`);
  }

  const a2 = await host(slots[1]! + 2_000, [fire(weekly.key, slots[1]), { op: "cancel-newest", count: 2, before: a1Tasks.map((t) => t.id) }, { op: "settle" }, { op: "tasks" }], "a2");
  setup(a2);
  const cancelled = of(a2.results, "cancel-newest")[0];
  const a2Tasks = tell.over("a · Alice's tasks after the second week", of(a2.results, "tasks")[0]?.out as Task[]);
  const second = a2Tasks.find((t) => t.id === cancelled?.taskId);
  if (a2Tasks.length !== 2 || second === undefined) failures.push(`a:second-week's-task — wanted two tasks, the second cancelled by Alice; got ${JSON.stringify(a2Tasks)}`);
  else if (second.status !== "cancelled") failures.push(`a:cancelled-like-any-task — Alice cancelled ${second.id} (${JSON.stringify(cancelled.out)}) and it ended ${second.status}`);
  else notes.push(`a: the next week's task, cancelled while ${cancelled.statusBefore}, ended cancelled`);

  // ---- leg b: one scheduled time, two hosts, a restart, a late retry ------------
  const before = a2Tasks.length;
  const [b1, b2] = await Promise.all([
    host(slots[2]! + 2_000, [fire(weekly.key, slots[2]), { op: "settle" }], "b1 host one"),
    host(slots[2]! + 2_000, [fire(weekly.key, slots[2]), { op: "settle" }], "b1 host two")
  ]);
  setup(b1);
  setup(b2);
  const restart = await host(slots[2]! + 5_000, [fire(weekly.key, slots[2]), { op: "settle" }, { op: "tasks" }], "b restart");
  setup(restart);
  const late = await host(slots[2]! + 20_000, [fire(weekly.key, slots[2]), { op: "settle" }, { op: "tasks" }], "b late");
  setup(late);
  const afterSlot = tell.over("b · Alice's tasks after one time from two hosts, a restart and a late retry", of(late.results, "tasks")[0]?.out as Task[]);
  const answers = [b1, b2, restart, late].map((r) => of(r.results, "fire")[0]?.status);
  if (afterSlot.length !== before + 1) {
    failures.push(`b:exactly-one-task — one scheduled time filed ${afterSlot.length - before} tasks (fires answered ${answers.join(", ")})`);
  } else notes.push(`b: one time from two hosts, a restart and 20 s late filed one task (answers ${answers.join(", ")})`);

  const early = await host(slots[3]! - 60_000, [fire(weekly.key), { op: "settle" }, { op: "tasks" }], "b untimed early");
  setup(early);
  const afterEarly = tell.over("b · Alice's tasks after an untimed fire a minute early", of(early.results, "tasks")[0]?.out as Task[]);
  if (afterEarly.length !== afterSlot.length) {
    failures.push(`b:early-files-nothing — an untimed POST a minute before the next time filed ${afterEarly.length - afterSlot.length} task(s) (${JSON.stringify(of(early.results, "fire")[0])})`);
  }
  const onTime = await host(slots[3]! + 2_000, [fire(weekly.key, slots[3]), { op: "settle" }, { op: "tasks" }], "b on time");
  setup(onTime);
  const afterOnTime = tell.over("b · Alice's tasks after the next time's own fire", of(onTime.results, "tasks")[0]?.out as Task[]);
  if (afterOnTime.length !== afterEarly.length + 1) failures.push(`b:its-own-fire-still-files — the next time's fire filed ${afterOnTime.length - afterEarly.length} task(s)`);
  else notes.push("b: an untimed POST a minute early filed nothing, and the time's own fire filed");

  // ---- leg c: her list, its next runs, and a change on the next read -----------
  const [kept, added] = fixture.listed as [Schedule, Schedule];
  const at = slots[3]! + 3_600_000;
  const c = await host(at, [save(kept), { op: "list" }, { op: "delete", key: kept.key }, save(added), { op: "list" }], "c");
  setup(c);
  const [firstRead, secondRead] = of(c.results, "list");
  const checkRead = (read: any, expected: Schedule[], name: string) => {
    const listed = tell.over(`c · Alice's schedules, ${name}`, (read?.out?.schedules ?? []) as Array<{ key: string; nextRunAt: string | null }>);
    const keys = listed.map((s) => s.key).sort();
    const wanted = expected.map((s) => s.key).sort();
    if (keys.join(",") !== wanted.join(",")) failures.push(`c:shows-the-change — ${name}: wanted ${wanted.join(", ")}, the list shows ${keys.join(", ")}`);
    const now = Date.parse(read?.now);
    for (const s of expected) {
      const row = listed.find((l) => l.key === s.key);
      const next = iso(nextAfter(s.cron, s.timezone, now));
      if (row !== undefined && row.nextRunAt !== next) failures.push(`c:next-run — ${name}: ${s.key} ("${s.cron}" in ${s.timezone}) shows ${row.nextRunAt}, its cron says ${next}`);
    }
  };
  checkRead(firstRead, [weekly, kept], "first read");
  checkRead(secondRead, [weekly, added], "after one removed and one added");
  notes.push(`c: next runs match each cron in its zone, before and after a remove and an add`);

  return { failures, evidence: notes.join("; ") };
});
