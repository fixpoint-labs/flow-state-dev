/**
 * Routines (FIX-2614): one list and four verbs over clock routines (schedule
 * rows) and event routines (subscription rows), for the user on the roster
 * flow and for a worker through its tools, plus the app's declared routines.
 *
 * Why these matter: the user trusts the list to show everything that runs as
 * them, from every writer, and to stop it. A paused routine that still fires,
 * a resume that skips the read check, or a resumed task routine that outlives
 * its failed task each breaks that trust. A seed that duplicates, or that
 * undoes a pause, makes the app's own routines unstoppable.
 */
import { afterEach, describe, expect, it } from "vitest";
import { CronExpressionParser } from "cron-parser";
import { createScheduledTransportAdapter, formatScheduleId } from "@flow-state-dev/scheduled";
import { inMemoryStores } from "@flow-state-dev/engine";
import { messageOf, ORG } from "./conversation-board-harness";
import { bootSubscriptionsHost, event, github, revoked, type SubscriptionsHost } from "./subscriptions-harness";
import { deriveWorkerSessionId } from "../src/workers/derive-session-id";
import { ROSTER_FLOW } from "../src/workers/keys";
import { SUBSCRIPTION_INDEX_PATTERN } from "../src/subscriptions/keys";
import type { DeclaredRoutine } from "../src/routines";
import type { SubscriptionProvider } from "../src/subscriptions";

const PR = "github:acme/api#412";
const PRIVATE = "github:acme/private#7";
const MONDAY = CronExpressionParser.parse("0 9 * * 1", { tz: "Europe/London", currentDate: new Date(Date.now() + 1) })
  .prev()
  .toDate()
  .toISOString();

type Listed = { id: string; name: string; worker: string; paused: boolean; madeBy?: { by: string; worker?: string; entry?: string } };

let host: SubscriptionsHost | undefined;
afterEach(async () => {
  revoked.clear();
  await host?.dispose();
  host = undefined;
});

function boot(
  options: {
    declared?: DeclaredRoutine[];
    stores?: ReturnType<typeof inMemoryStores>;
    hold?: Promise<void>;
    provider?: SubscriptionProvider;
    isolatedFollower?: boolean;
  } = {}
) {
  host = bootSubscriptionsHost({
    adapters: [createScheduledTransportAdapter()],
    hire: { routines: { providers: [options.provider ?? github], ...(options.declared === undefined ? {} : { declared: options.declared }) } },
    ...(options.stores === undefined ? {} : { stores: options.stores }),
    ...(options.hold === undefined ? {} : { hold: options.hold }),
    ...(options.isolatedFollower === true ? { isolatedFollower: true } : {})
  });
  return host;
}

/** `github`, whose read check waits on a gate the test opens: a request parks there mid-resume. */
function gatedGithub() {
  let reached!: () => void;
  let open!: () => void;
  const atGate = new Promise<void>((resolve) => (reached = resolve));
  const gate = new Promise<void>((resolve) => (open = resolve));
  let armed = false;
  const provider: SubscriptionProvider = {
    ...github,
    canRead: async (thread, ctx) => {
      if (armed) {
        armed = false;
        reached();
        await gate;
      }
      return github.canRead(thread, ctx);
    }
  };
  return { provider, arm: () => (armed = true), atGate, open: () => open() };
}

const roster = (h: SubscriptionsHost, user: string, action: string, input: unknown) => h.act(user, `roster-${user}`, action, input, "roster");
const list = async (h: SubscriptionsHost, user = "alice") => ((await roster(h, user, "listRoutines", {})).output as { routines: Listed[] }).routines;
const ok = <T>(output: unknown): T => {
  const answer = output as { ok: boolean; error?: string; routine?: T };
  if (!answer.ok) throw new Error(`refused: ${answer.error}`);
  return answer.routine as T;
};

const weekly = (name: string, filer = "lead") => ({
  name,
  trigger: { clock: { cron: "0 9 * * 1", timezone: "Europe/London" } },
  task: { filer, goal: "Refresh the adoption numbers", assignee: "eng.tasker" }
});

/** POST a clock routine's fire as a host's cron does. */
async function fire(h: SubscriptionsHost, key: string, user = "alice") {
  const id = formatScheduleId(ORG, user, key);
  const response = await (await h.router()).POST(
    new Request(`http://localhost/api/flows/${ROSTER_FLOW}/schedules/${encodeURIComponent(id)}/dispatch`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user": "scheduler" },
      body: JSON.stringify({ nominalFireTime: MONDAY })
    }),
    { params: { path: [ROSTER_FLOW, "schedules", id, "dispatch"] } }
  );
  await h.settled();
  return response.status;
}

/** The subscription ids the org's thread index names for `thread`, from the store. */
async function indexed(h: SubscriptionsHost, thread: string) {
  const runtime = await h.state.getRuntime();
  const row = await runtime.stores.resourceState.get("org", ORG, `${SUBSCRIPTION_INDEX_PATTERN.replace("*", "")}${encodeURIComponent(thread)}`);
  return Object.keys((row?.state as { subscriptions?: Record<string, unknown> } | undefined)?.subscriptions ?? {});
}

/** Alice's conversation with the follower worker, as a user's event routine derives it. */
const followerConversation = () => deriveWorkerSessionId({ userId: "alice", orgId: ORG, flow: "follower", criteria: { worker: "eng.follower" } });

describe("one list over every writer", () => {
  it("lists what the roster, a worker's tools and a task's subscribe made, each with its maker, and nothing of another user's", async () => {
    const h = boot();
    ok(await roster(h, "alice", "saveRoutine", weekly("adoption")).then((r) => r.output));
    ok((await roster(h, "alice", "saveRoutine", { trigger: { event: { provider: "github", thread: PR, interest: "reviews" } }, worker: "eng.follower" })).output);
    const chat = await h.follower("alice");
    ok((await h.act("alice", chat, "saveRoutine", { trigger: { event: { provider: "github", thread: "github:acme/api#9", interest: "CI" } } }, "follower")).output);
    ok((await h.act("alice", chat, "saveRoutine", { name: "standup", trigger: { clock: { cron: "0 8 * * 1-5" } }, task: { goal: "Post the standup" } }, "follower")).output);

    const listed = await list(h);
    expect(listed.map((r) => [r.id.split(":")[0], r.name, r.worker, r.madeBy]).sort()).toEqual(
      [
        ["clock", "adoption", "lead", { by: "user" }],
        ["clock", "standup", "eng.follower", { by: "worker", worker: "eng.follower" }],
        ["event", PR, "eng.follower", { by: "user" }],
        ["event", "github:acme/api#9", "eng.follower", { by: "worker", worker: "eng.follower" }]
      ].sort()
    );
    expect(await list(h, "bob")).toEqual([]);
  });

  it("gives a worker only the routines that act through it, and refuses the rest as not yours", async () => {
    const h = boot();
    const adoption = ok<Listed>((await roster(h, "alice", "saveRoutine", weekly("adoption"))).output);
    const chat = await h.follower("alice");
    expect((await h.act("alice", chat, "listRoutines", {}, "follower")).output).toEqual({ routines: [] });
    expect((await h.act("alice", chat, "pauseRoutine", { id: adoption.id, paused: true }, "follower")).output).toEqual({
      ok: false,
      error: expect.stringMatching(/^not_yours/)
    });
    expect((await h.act("alice", chat, "saveRoutine", weekly("other", "lead"), "follower")).output).toMatchObject({ ok: false, error: expect.stringMatching(/^not_yours/) });
  });

  it("lists a subscription saved before routines existed, and it still delivers", async () => {
    const h = boot();
    const chat = await h.follower("alice");
    const { id } = (await h.subscribe("alice", chat, { thread: PR })) as { id: string };
    // As `main` wrote it: no maker on the row.
    const runtime = await h.state.getRuntime();
    const cell = `alice:~org:${ORG}`;
    const key = `workforce/subscriptions/${id}`;
    const stored = (await runtime.stores.resourceState.get("user", cell, key))!;
    const { madeBy: _gone, ...legacy } = stored.state as Record<string, unknown>;
    await runtime.stores.resourceState.set("user", cell, key, legacy as never, "any");
    expect((await list(h)).map((r) => [r.id, r.madeBy])).toEqual([[`event:${id}`, undefined]]);
    await h.route(event());
    expect(await h.heard(chat)).toHaveLength(1);
  });
});

describe("a worker flow that isolates its users' state", () => {
  it("still writes the clock routine the roster lists and fires", async () => {
    const h = boot({ isolatedFollower: true });
    const chat = await h.follower("alice");
    ok((await h.act("alice", chat, "saveRoutine", { name: "standup", trigger: { clock: { cron: "0 9 * * 1" } }, task: { goal: "Post the standup" } }, "follower")).output);
    expect((await list(h)).map((r) => r.id)).toEqual(["clock:standup"]);
    expect((await h.act("alice", chat, "listRoutines", {}, "follower")).output).toMatchObject({ routines: [{ id: "clock:standup" }] });
  });
});

describe("pause, resume and delete", () => {
  it("a paused clock routine files nothing; resumed, it files again; deleted, it is gone", async () => {
    const h = boot();
    const routine = ok<Listed>((await roster(h, "alice", "saveRoutine", weekly("adoption"))).output);
    ok((await roster(h, "alice", "pauseRoutine", { id: routine.id, paused: true })).output);
    await fire(h, "adoption");
    expect(h.runs).toHaveLength(0);
    expect((await list(h))[0]).toMatchObject({ id: routine.id, paused: true });

    ok((await roster(h, "alice", "pauseRoutine", { id: routine.id, paused: false })).output);
    expect(await fire(h, "adoption")).toBe(202);
    expect(h.runs.map((run) => run.worker)).toEqual(["eng.tasker"]);

    expect((await roster(h, "alice", "deleteRoutine", { id: routine.id })).output).toEqual({ ok: true });
    expect(await list(h)).toEqual([]);
  });

  it("a paused event routine delivers nothing and leaves the thread index; resumed, it delivers; deleted, nothing", async () => {
    const h = boot();
    const routine = ok<Listed>((await roster(h, "alice", "saveRoutine", { trigger: { event: { provider: "github", thread: PR, interest: "reviews" } }, worker: "eng.follower" })).output);
    const subscription = routine.id.replace(/^event:/, "");
    const hearer = await followerConversation();
    await h.route(event({ text: "first" }));
    expect(await h.heard(hearer)).toHaveLength(1);

    ok((await roster(h, "alice", "pauseRoutine", { id: routine.id, paused: true })).output);
    expect(await indexed(h, PR)).not.toContain(subscription);
    await h.route(event({ text: "while paused" }));
    expect(await h.heard(hearer)).toHaveLength(1);
    expect((await list(h))[0]).toMatchObject({ id: routine.id, paused: true });

    ok((await roster(h, "alice", "pauseRoutine", { id: routine.id, paused: false })).output);
    expect(await indexed(h, PR)).toContain(subscription);
    await h.route(event({ text: "after resume" }));
    expect((await h.heard(hearer)).at(-1)).toContain("after resume");

    expect((await roster(h, "alice", "deleteRoutine", { id: routine.id })).output).toEqual({ ok: true });
    expect(await list(h)).toEqual([]);
    await h.route(event({ text: "after delete" }));
    expect(await h.heard(hearer)).toHaveLength(2);
  });

  it("deletes a paused event routine for good: it no longer lists", async () => {
    const h = boot();
    const routine = ok<Listed>((await roster(h, "alice", "saveRoutine", { trigger: { event: { provider: "github", thread: PR, interest: "reviews" } }, worker: "eng.follower" })).output);
    ok((await roster(h, "alice", "pauseRoutine", { id: routine.id, paused: true })).output);
    expect((await roster(h, "alice", "deleteRoutine", { id: routine.id })).output).toEqual({ ok: true });
    expect(await list(h)).toEqual([]);
    expect((await roster(h, "alice", "pauseRoutine", { id: routine.id, paused: false })).output).toMatchObject({ ok: false, error: expect.stringMatching(/^no_routine/) });
  });

  it("refuses a resume once read access was taken away while it was paused, and it stays paused", async () => {
    const h = boot();
    const routine = ok<Listed>((await roster(h, "alice", "saveRoutine", { trigger: { event: { provider: "github", thread: PRIVATE, interest: "x" } }, worker: "eng.follower" })).output);
    ok((await roster(h, "alice", "pauseRoutine", { id: routine.id, paused: true })).output);
    revoked.add("alice");
    expect((await roster(h, "alice", "pauseRoutine", { id: routine.id, paused: false })).output).toEqual({ ok: false, error: expect.stringMatching(/^not_readable/) });
    expect((await list(h))[0]).toMatchObject({ id: routine.id, paused: true });
    expect(await indexed(h, PRIVATE)).toEqual([]);
  });

  it("a tenant's routine, resumed from a roster in no tenant, stays under its tenant and still reaches its session", async () => {
    const h = boot();
    const chat = await h.followerInTenant("alice", "tenant-a");
    const { id } = (await h.subscribe("alice", chat, { thread: PR }, "tenant-a")) as { id: string };
    ok((await roster(h, "alice", "pauseRoutine", { id: `event:${id}`, paused: true })).output);
    ok((await roster(h, "alice", "pauseRoutine", { id: `event:${id}`, paused: false })).output);
    expect((await h.subscriptionRows("alice"))[0]).toMatchObject({ id, enabled: true, tenantId: "tenant-a" });
    const routed = await h.route(event({ text: "after a resume elsewhere" }));
    expect(routed.ownerRuns.map((run) => run.run.owner.tenantId)).toEqual(["tenant-a"]);
  });

  it("a resume racing a delete leaves it deleted: no row back on, no index entry back", async () => {
    const gated = gatedGithub();
    const h = boot({ provider: gated.provider });
    const routine = ok<Listed>((await roster(h, "alice", "saveRoutine", { trigger: { event: { provider: "github", thread: PR, interest: "reviews" } }, worker: "eng.follower" })).output);
    const sub = routine.id.slice("event:".length);
    ok((await roster(h, "alice", "pauseRoutine", { id: routine.id, paused: true })).output);
    gated.arm();
    const resuming = roster(h, "alice", "pauseRoutine", { id: routine.id, paused: false });
    await gated.atGate;
    // The delete lands while the resume waits on the read check: from a worker's tools, another session.
    const chat = await h.follower("alice");
    expect((await h.act("alice", chat, "deleteRoutine", { id: routine.id }, "follower")).output).toEqual({ ok: true });
    gated.open();
    expect((await resuming).output).toMatchObject({ ok: false, error: expect.stringMatching(/^ended/) });
    expect((await h.subscriptionRows("alice")).find((r) => r.id === sub)).toMatchObject({ enabled: false, endedReason: "unsubscribed" });
    expect(await indexed(h, PR)).not.toContain(sub);
    expect(await list(h)).toEqual([]);
  });

  it("a task's routine, paused then resumed, still ends when its task fails", async () => {
    let open!: () => void;
    const h = boot({ hold: new Promise<void>((resolve) => (open = resolve)) });
    const conv = await h.conversation("alice", "lead");
    const filed = await h.act("alice", conv, "createTask_tasks", { goal: `open the PR [subscribe:${PR}] [hold] [fail]`, assignee: "eng.follower" });
    expect(filed.error, messageOf(filed.error)).toBeUndefined();
    for (let i = 0; i < 500 && (await h.subscriptionRows("alice")).length === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    const [row] = await h.subscriptionRows("alice");
    const id = `event:${row!.id}`;
    ok((await roster(h, "alice", "pauseRoutine", { id, paused: true })).output);
    ok((await roster(h, "alice", "pauseRoutine", { id, paused: false })).output);
    expect((await h.subscriptionRows("alice"))[0]).toMatchObject({ enabled: true, taskId: row!.taskId });
    open();
    await h.settled();
    expect((await h.subscriptionRows("alice")).map((r) => [r.enabled, r.endedReason])).toEqual([[false, "task_errored"]]);
    expect(await list(h)).toEqual([]);
  });
});

describe("the app's declared routines", () => {
  const declared = (cron = "0 9 * * 1"): DeclaredRoutine[] => [
    { id: "weekly-adoption", trigger: { clock: { cron, timezone: "Europe/London" } }, task: { filer: "lead", goal: "Refresh the adoption numbers", assignee: "eng.tasker" } },
    { id: "api-reviews", trigger: { event: { provider: "github", thread: PR, interest: "reviews", everyMinutes: 15 } }, worker: "eng.follower" }
  ];

  it("seeds each once per user however often the roster runs, made by the app", async () => {
    const h = boot({ declared: declared() });
    await list(h);
    const listed = await list(h);
    expect(listed.map((r) => [r.id.split(":")[0], r.madeBy]).sort()).toEqual([
      ["clock", { by: "app", entry: "weekly-adoption" }],
      ["event", { by: "app", entry: "api-reviews" }]
    ]);
    expect((await list(h, "bob")).map((r) => r.madeBy?.entry).sort()).toEqual(["api-reviews", "weekly-adoption"]);
  });

  it("lets the user pause one, and refuses a save over it or a delete, naming why", async () => {
    const h = boot({ declared: declared() });
    const [clock] = (await list(h)).filter((r) => r.id.startsWith("clock:"));
    ok((await roster(h, "alice", "pauseRoutine", { id: clock!.id, paused: true })).output);
    expect((await roster(h, "alice", "deleteRoutine", { id: clock!.id })).output).toEqual({ ok: false, error: expect.stringMatching(/^declared/) });
    expect((await roster(h, "alice", "saveRoutine", weekly(clock!.name))).output).toMatchObject({ ok: false, error: expect.stringMatching(/^declared/) });
  });

  it("takes a config change on the next run and keeps each pause", async () => {
    const stores = inMemoryStores();
    const first = boot({ declared: declared(), stores });
    for (const routine of await list(first)) ok((await roster(first, "alice", "pauseRoutine", { id: routine.id, paused: true })).output);
    await first.dispose();
    host = undefined;

    // A redeploy: the clock entry's cron changed, the event entry's interest too.
    const changed = declared("30 7 * * *");
    (changed[1]!.trigger as { event: { interest: string } }).event.interest = "only reviews";
    const second = boot({ declared: changed, stores });
    const listed = await list(second);
    expect(listed).toHaveLength(2);
    expect(listed.every((r) => r.paused)).toBe(true);
    expect(listed.find((r) => r.id.startsWith("clock:"))).toMatchObject({ trigger: { clock: { cron: "30 7 * * *" } } });
    expect(listed.find((r) => r.id.startsWith("event:"))).toMatchObject({ trigger: { event: { interest: "only reviews" } } });
    expect(await indexed(second, PR)).toEqual([]);
  });

  it("moves a declared event routine to its new thread: the old thread's index entry goes", async () => {
    const stores = inMemoryStores();
    const first = boot({ declared: declared(), stores });
    const [event] = (await list(first)).filter((r) => r.id.startsWith("event:"));
    const sub = event!.id.slice("event:".length);
    expect(await indexed(first, PR)).toContain(sub);
    await first.dispose();
    host = undefined;
    const moved = declared();
    (moved[1]!.trigger as { event: { thread: string } }).event.thread = "github:acme/api#999";
    const second = boot({ declared: moved, stores });
    await list(second);
    expect(await indexed(second, PR)).not.toContain(sub);
    expect(await indexed(second, "github:acme/api#999")).toContain(sub);
  });

  it("cleans up a declared clock routine once config declares none at all", async () => {
    const stores = inMemoryStores();
    const first = boot({ declared: declared(), stores });
    expect((await list(first)).some((r) => r.id.startsWith("clock:cfg_"))).toBe(true);
    await first.dispose();
    host = undefined;
    const second = boot({ declared: [], stores });
    expect((await list(second)).filter((r) => r.id.startsWith("clock:"))).toEqual([]);
  });

  it("refuses a declared routine that would never fire before anything registers", () => {
    expect(() => boot({ declared: [{ id: "bad", trigger: { event: { provider: "github", thread: PR, interest: "x", everyMinutes: 3 } } }] }).router()).toThrow(
      /needs a worker[\s\S]*invalid_cadence/
    );
  });
});
