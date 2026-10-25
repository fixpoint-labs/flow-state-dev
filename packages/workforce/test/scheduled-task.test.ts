/**
 * Recurring work is a schedule that files an ordinary task (FIX-2085): a row in
 * the user's schedule collection, fired through the scheduled-dispatch
 * endpoint, files a task on the named worker's board in the user's own
 * conversation with it, through the board's own filing, as the user. The user's
 * list of schedules shows each one's next run, worked out from its cron.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { CronExpressionParser } from "cron-parser";
import { createScheduledTransportAdapter, formatScheduleId, type ScheduleIndex, type ScheduleIndexRow } from "@flow-state-dev/scheduled";
import { bootBoardHost, ORG, type BoardHost } from "./conversation-board-harness";
import { deriveWorkerSessionId } from "../src/workers/derive-session-id";
import { ROSTER_FLOW } from "../src/workers/keys";

const ALICE = "alice";
/**
 * The last two Mondays 09:00 in London already due: times of the weekly cron
 * that aren't stale (a time more than one period behind the latest runs nothing).
 */
const mondays = CronExpressionParser.parse("0 9 * * 1", { tz: "Europe/London", currentDate: new Date(Date.now() + 1) });
const NEXT_MONDAY = mondays.prev().toDate().toISOString();
const MONDAY = mondays.prev().toDate().toISOString();

const weekly = {
  key: "adoption",
  cron: "0 9 * * 1",
  timezone: "Europe/London",
  kind: "task",
  input: { filer: "lead", goal: "Refresh the adoption numbers", assignee: "eng.tasker" }
};

let host: BoardHost | undefined;
afterEach(async () => {
  vi.useRealTimers();
  await host?.dispose();
  host = undefined;
});

function boot(options: Parameters<typeof bootBoardHost>[0] = {}) {
  host = bootBoardHost({ adapters: [createScheduledTransportAdapter()], ...options });
  return host;
}

/** POST a fire as a host's cron does: the gateway is the scheduler, not the user. */
async function fire(h: BoardHost, key: string, body: Record<string, unknown> = {}) {
  const id = formatScheduleId(ORG, ALICE, key);
  const response = await (await h.router()).POST(
    new Request(`http://localhost/api/flows/${ROSTER_FLOW}/schedules/${encodeURIComponent(id)}/dispatch`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user": "scheduler" },
      body: JSON.stringify(body)
    }),
    { params: { path: [ROSTER_FLOW, "schedules", id, "dispatch"] } }
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const roster = (h: BoardHost, action: string, input: unknown) => h.act(ALICE, `roster-${ALICE}`, action, input, "roster");

/** Alice's conversation with `worker`: its derived address, where her own message reaches it. */
const conversationWith = (worker: string, flow = "coordinator") =>
  deriveWorkerSessionId({ userId: ALICE, orgId: ORG, flow, criteria: { worker } });

/** Alice's tasks in her conversation with lead, through the public task read; none while it isn't open. */
async function aliceTasks(h: BoardHost) {
  const conversation = await conversationWith("lead");
  if ((await (await h.state.getRuntime()).stores.session.get(conversation)) === undefined) return [];
  const listed = await h.act(ALICE, conversation, "listTasks_tasks", {});
  const output = listed.output as { ok: boolean; tasks?: Array<{ id: string; goal: string; assignee?: string; status: string }> };
  return output.ok ? output.tasks! : [];
}

/** Why each failed request failed, oldest first: a refused filing names its reason. */
async function failures(h: BoardHost) {
  const all = await (await h.state.getRuntime()).stores.request.list({});
  return all
    .filter((request) => request.result?.error !== undefined)
    .sort((a, b) => a.startedAtMs - b.startedAtMs)
    .map((request) => `${request.actionName}: ${request.result?.error?.message ?? ""}`);
}

describe("a schedule that files a task", () => {
  it("files one ordinary task on the filer's board, as the user, and it runs", async () => {
    const h = boot();
    expect((await roster(h, "saveSchedule", weekly)).output).toMatchObject({ ok: true });

    const fired = await fire(h, weekly.key, { nominalFireTime: MONDAY });
    expect(fired.status).toBe(202);
    await h.settled();

    const tasks = await aliceTasks(h);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ goal: weekly.input.goal, assignee: "eng.tasker", status: "completed" });
    // Worked by the assignee, as Alice, in a task session the board opened.
    expect(h.runs.map((run) => [run.worker, run.userId])).toEqual([["eng.tasker", ALICE]]);
  });

  it("answers the same scheduled time again as a duplicate, filing nothing more", async () => {
    const h = boot();
    await roster(h, "saveSchedule", weekly);
    expect((await fire(h, weekly.key, { nominalFireTime: MONDAY })).status).toBe(202);
    await h.settled();
    const again = await fire(h, weekly.key, { nominalFireTime: MONDAY });
    expect(again.body.status).toBe("duplicate");
    await h.settled();
    expect(await aliceTasks(h)).toHaveLength(1);

    // The next week's time files its own task, even with last week's done.
    expect((await fire(h, weekly.key, { nominalFireTime: NEXT_MONDAY })).status).toBe(202);
    await h.settled();
    expect(await aliceTasks(h)).toHaveLength(2);
  });

  it("files nothing when the filer is not on the user's roster", async () => {
    const h = boot();
    await roster(h, "saveSchedule", { ...weekly, input: { ...weekly.input, filer: "nobody" } });
    await fire(h, weekly.key, { nominalFireTime: MONDAY });
    await h.settled();
    expect(await aliceTasks(h)).toHaveLength(0);
    expect(h.runs).toHaveLength(0);
    expect(await failures(h)).toEqual([expect.stringContaining('no worker "nobody" on your roster')]);
  });

  it("files nothing when the assignee is the filer itself", async () => {
    const h = boot();
    await roster(h, "saveSchedule", { ...weekly, input: { ...weekly.input, assignee: "lead" } });
    await fire(h, weekly.key, { nominalFireTime: MONDAY });
    await h.settled();
    expect(await aliceTasks(h)).toHaveLength(0);
    expect(h.runs).toHaveLength(0);
    expect(await failures(h)).toEqual([expect.stringContaining('its assignee is its filer, "lead"')]);
  });

  it("files nothing when the assignee is not among the filer's delegates", async () => {
    const h = boot();
    await roster(h, "saveSchedule", { ...weekly, input: { ...weekly.input, assignee: "eng.writer" } });
    await fire(h, weekly.key, { nominalFireTime: MONDAY });
    await h.settled();
    expect(await aliceTasks(h)).toHaveLength(0);
    expect(h.runs).toHaveLength(0);
    // The board's own filing refused it, in Alice's conversation with lead.
    expect(await failures(h)).toEqual([expect.stringMatching(/^fileScheduledTask: The scheduled task wasn't filed: .*eng\.writer/)]);
  });

  it("files nothing, every fire, when it names no assignee and the filer has several delegates: no unassigned rows pile up", async () => {
    const h = boot();
    // pm has two delegates that take tasks, so no one of them is the default.
    await roster(h, "saveSchedule", { ...weekly, input: { filer: "pm", goal: weekly.input.goal } });
    await fire(h, weekly.key, { nominalFireTime: MONDAY });
    await h.settled();
    await fire(h, weekly.key, { nominalFireTime: NEXT_MONDAY });
    await h.settled();
    const conversation = await conversationWith("pm");
    const session = await (await h.state.getRuntime()).stores.session.get(conversation);
    const rows = session === undefined ? [] : ((await h.act(ALICE, conversation, "listTasks_tasks", {})).output as { tasks?: unknown[] }).tasks ?? [];
    expect(rows).toEqual([]);
    expect(h.runs).toHaveLength(0);
    expect(await failures(h)).toEqual([
      expect.stringMatching(/^fileScheduledTask: The scheduled task wasn't filed: it names no assignee/),
      expect.stringMatching(/^fileScheduledTask: The scheduled task wasn't filed: it names no assignee/)
    ]);
  });

  it("gives a fire that names no assignee to the filer's only delegate", async () => {
    const h = boot();
    await roster(h, "saveSchedule", { ...weekly, input: { filer: "lead", goal: weekly.input.goal } });
    expect((await fire(h, weekly.key, { nominalFireTime: MONDAY })).status).toBe(202);
    await h.settled();
    expect(await aliceTasks(h)).toEqual([expect.objectContaining({ goal: weekly.input.goal, assignee: "eng.tasker", status: "completed" })]);
  });
});

describe("the user's list of schedules", () => {
  it("shows each schedule with its next run, worked out from its cron and time zone", async () => {
    // Pinned to a Wednesday noon UTC: the daily run (07:30 New York) is the next
    // morning, days before Monday 09:00 London. Left on the real clock, a Sunday
    // after 11:30 UTC puts the weekly run first and the order below flips.
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-21T12:00:00Z") });
    const h = boot();
    await roster(h, "saveSchedule", weekly);
    await roster(h, "saveSchedule", { ...weekly, key: "daily", cron: "30 7 * * *", timezone: "America/New_York" });
    const before = Date.now();
    const listed = (await roster(h, "listSchedules", {})).output as {
      schedules: Array<{ key: string; cron: string; timezone: string; nextRunAt: string | null }>;
    };
    const byKey = Object.fromEntries(listed.schedules.map((s) => [s.key, s]));
    expect(Object.keys(byKey).sort()).toEqual(["adoption", "daily"]);
    const nextRun = (schedule: { cron: string; timezone: string }) =>
      CronExpressionParser.parse(schedule.cron, { tz: schedule.timezone, currentDate: new Date(before) })
        .next()
        .toDate()
        .toISOString();
    // Soonest first, whatever their keys. Which one is sooner depends on when the test runs
    // (on a Sunday evening Monday's 9am London comes before 7:30am New York), so the order is
    // worked out from the crons themselves.
    const soonestFirst = listed.schedules
      .map((s) => ({ key: s.key, at: nextRun(s) }))
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((s) => s.key);
    expect(listed.schedules.map((s) => s.key)).toEqual(soonestFirst);
    for (const schedule of listed.schedules) {
      expect(schedule.nextRunAt).toBe(nextRun(schedule));
    }
  });

  it("shows a schedule added or removed on its next read", async () => {
    const h = boot();
    const keys = async () =>
      ((await roster(h, "listSchedules", {})).output as { schedules: Array<{ key: string }> }).schedules.map((s) => s.key);
    expect(await keys()).toEqual([]);
    await roster(h, "saveSchedule", weekly);
    expect(await keys()).toEqual(["adoption"]);
    await roster(h, "deleteSchedule", { key: "adoption" });
    expect(await keys()).toEqual([]);
  });

  it("refuses a schedule whose cron doesn't parse, writing nothing", async () => {
    const h = boot();
    const saved = (await roster(h, "saveSchedule", { ...weekly, cron: "every monday" })).output as { ok: boolean; error?: string };
    expect(saved.ok).toBe(false);
    expect(saved.error).toMatch(/cron/);
    expect(((await roster(h, "listSchedules", {})).output as { schedules: unknown[] }).schedules).toEqual([]);
  });

  it("refuses a cron that isn't exactly five fields, which would fire every second", async () => {
    const h = boot();
    const saved = (await roster(h, "saveSchedule", { ...weekly, cron: "* * * * * *" })).output as { ok: boolean; error?: string };
    expect(saved.ok).toBe(false);
    expect(saved.error).toMatch(/five fields/);
    expect(((await roster(h, "listSchedules", {})).output as { schedules: unknown[] }).schedules).toEqual([]);
  });

  it("refuses a time zone the dispatch would refuse, so no saved schedule fails every fire", async () => {
    const h = boot();
    // cron-parser accepts "UTC+5"; the endpoint's zone check doesn't.
    const saved = (await roster(h, "saveSchedule", { ...weekly, timezone: "UTC+5" })).output as { ok: boolean; error?: string };
    expect(saved.ok).toBe(false);
    expect(saved.error).toMatch(/time zone/);
    expect(((await roster(h, "listSchedules", {})).output as { schedules: unknown[] }).schedules).toEqual([]);
  });

  it("takes its fired record with it when deleted, so the key saved again starts fresh", async () => {
    const h = boot();
    await roster(h, "saveSchedule", weekly);
    expect((await fire(h, weekly.key, { nominalFireTime: NEXT_MONDAY })).status).toBe(202);
    await h.settled();
    const runtime = await h.state.getRuntime();
    const record = () =>
      runtime.stores.resourceState.get(
        "user",
        `${ALICE}:~org:${ORG}`,
        `scheduled-fires/${ROSTER_FLOW}/${formatScheduleId(ORG, ALICE, weekly.key)}`
      );
    expect(await record()).toBeDefined();
    await roster(h, "deleteSchedule", { key: weekly.key });
    expect(await record()).toBeUndefined();
    // Saved again under the same key, it is a new schedule: its time fires.
    await roster(h, "saveSchedule", weekly);
    expect((await fire(h, weekly.key, { nominalFireTime: NEXT_MONDAY })).status).toBe(202);
    await h.settled();
  });

  it("mirrors each saved schedule into the index the host configured", async () => {
    const upserts: ScheduleIndexRow[] = [];
    const removed: string[] = [];
    const index: ScheduleIndex = {
      upsert: async (row) => void upserts.push(row),
      remove: async (id) => void removed.push(id.key),
      claimDue: async () => []
    };
    const h = boot({ hire: { schedules: { index } } });
    await roster(h, "saveSchedule", weekly);
    expect(upserts.map((row) => [row.userId, row.orgId, row.key, row.cron])).toEqual([[ALICE, ORG, "adoption", weekly.cron]]);
    await roster(h, "deleteSchedule", { key: "adoption" });
    expect(removed).toEqual(["adoption"]);
  });
});
