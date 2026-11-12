// FIX-2624.
/**
 * An app's declared routines reach a user with no roster session: they are
 * seeded on the user's first request to any of the installation's flows (a
 * worker's turn, or a roster write), listed by the roster flow's `routines`
 * view before and after that, and paused or deleted by a send to the routines
 * collection, which the roster flow writes (`runBy`).
 *
 * Why it matters: a user who only ever talks to a worker must still see the
 * app's routines and have them fire, and no read may make a session. A seed
 * that writes twice, or that writes into another organization's cell, makes
 * the app's own routines fire twice or for the wrong people.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "@flow-state-dev/client";
import { createScheduledTransportAdapter, formatScheduleId } from "@flow-state-dev/scheduled";
import { CronExpressionParser } from "cron-parser";
import { ORG } from "./conversation-board-harness";
import { bootSubscriptionsHost, github, revoked, type SubscriptionsHost } from "./subscriptions-harness";
import { ROSTER_FLOW } from "../src/workers/keys";
import { SCHEDULES_PATTERN } from "../src/schedules/keys";
import { routinesView } from "../src/routines/routines-view-ref";
import { declaredRoutineKey, type DeclaredRoutine } from "../src/routines";

const OTHER_ORG = "globex";
const PR = "github:acme/api#412";
const MONDAY = CronExpressionParser.parse("0 9 * * 1", { tz: "Europe/London", currentDate: new Date(Date.now() + 1) })
  .prev()
  .toDate()
  .toISOString();

const DECLARED: DeclaredRoutine[] = [
  { id: "weekly-adoption", trigger: { clock: { cron: "0 9 * * 1", timezone: "Europe/London" } }, task: { filer: "lead", goal: "Refresh the adoption numbers", assignee: "eng.tasker" } },
  { id: "api-reviews", trigger: { event: { provider: "github", thread: PR, interest: "reviews", everyMinutes: 15 } }, worker: "eng.follower" }
];

let host: SubscriptionsHost | undefined;
afterEach(async () => {
  revoked.clear();
  await host?.dispose();
  host = undefined;
});

function boot() {
  host = bootSubscriptionsHost({
    adapters: [createScheduledTransportAdapter()],
    hire: { routines: { providers: [github], declared: DECLARED } }
  });
  return host;
}

/** POST to the host's router as `userId` in `orgId`. */
async function post(h: SubscriptionsHost, userId: string, orgId: string, path: string[], body: unknown) {
  return (await h.router()).POST(
    new Request(`http://localhost/api/flows/${path.join("/")}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user": userId, "x-org": orgId },
      body: JSON.stringify(body)
    }),
    { params: { path } }
  );
}

/** A client of the host, signed in as `userId` in `orgId`. */
function clientOf(h: SubscriptionsHost, userId: string, orgId = ORG) {
  return createClient({
    userId,
    fetcher: async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(new URL(String(input instanceof Request ? input.url : input), "http://localhost"), init);
      request.headers.set("x-user", userId);
      request.headers.set("x-org", orgId);
      const path = new URL(request.url).pathname.replace(/^\/api\/flows\//, "").split("/").map(decodeURIComponent);
      const router = await h.router();
      return request.method === "GET" ? router.GET(request, { params: { path } }) : router.POST(request, { params: { path } });
    }
  });
}

/** One worker turn as `userId` in `orgId`, in their follower conversation: no roster request. */
async function workerTurn(h: SubscriptionsHost, userId: string, orgId = ORG, sessionId = `follow-${userId}-${orgId}`) {
  const runtime = await h.state.getRuntime();
  if ((await runtime.stores.session.get(sessionId)) === undefined) {
    const created = await post(h, userId, orgId, ["follower", "sessions"], { userId, sessionId, state: { workerId: "eng.follower" } });
    expect([200, 201]).toContain(created.status);
  }
  const done = await h.act(userId, sessionId, "respond", { message: "hello" }, "follower", orgId);
  expect(done.error).toBeUndefined();
  await h.settled();
}

/** The stored routine rows in `userId`'s cell in `orgId`, with their versions. */
async function storedRoutines(h: SubscriptionsHost, userId: string, orgId = ORG) {
  const runtime = await h.state.getRuntime();
  const cell = `${userId}:~org:${orgId}`;
  const rows = { ...(await runtime.stores.resourceState.getByPrefix("user", cell, "workforce/schedules/")), ...(await runtime.stores.resourceState.getByPrefix("user", cell, "workforce/subscriptions/")) };
  return Object.fromEntries(Object.entries(rows).map(([key, stored]) => [key, (stored as { version: number }).version]));
}

/** The sessions in the store on the roster flow, the write sessions aside. */
async function rosterSessions(h: SubscriptionsHost) {
  const runtime = await h.state.getRuntime();
  return (await runtime.stores.session.list({ parentage: "all" } as never)).filter((s) => s.flowKind === ROSTER_FLOW).map((s) => s.id);
}

/** POST a clock routine's fire as a host's cron does. */
async function fire(h: SubscriptionsHost, key: string, user: string) {
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

describe("an app's declared routines, for a user who only talks to a worker", () => {
  it("are listed, are seeded by the first worker turn, and fire, with no roster session made", async () => {
    const h = boot();
    const alice = clientOf(h, "alice");
    // Listed before any request: the view joins the declared entries to what is stored.
    const before = (await alice.view(routinesView, {})).value.routines;
    expect(before.map((r) => [r.id.split(":")[0], r.madeBy]).sort()).toEqual([
      ["clock", { by: "app", entry: "weekly-adoption" }],
      ["event", { by: "app", entry: "api-reviews" }]
    ]);
    expect(await storedRoutines(h, "alice")).toEqual({});

    await workerTurn(h, "alice");
    const clockKey = await declaredRoutineKey("weekly-adoption");
    expect(Object.keys(await storedRoutines(h, "alice")).sort()).toEqual([`workforce/schedules/${clockKey}`, `workforce/subscriptions/${await declaredRoutineKey("api-reviews")}`]);
    expect((await alice.view(routinesView, {})).value.routines.map((r) => r.id).sort()).toEqual(before.map((r) => r.id).sort());

    // Listing and seeding made no roster session.
    expect(await rosterSessions(h)).toEqual([]);
    expect(await fire(h, clockKey, "alice")).toBe(202);
    expect(h.runs.map((run) => run.worker)).toEqual(["eng.tasker"]);
    // The fire's own dispatch runs in a one-off session; still no session a reader keeps.
    for (const id of await rosterSessions(h)) expect(id).toMatch(/^ephemeral_/);
  });

  it("writes each declared routine once per user: two first requests at once write one row each, and a later one writes nothing", async () => {
    const h = boot();
    await Promise.all([workerTurn(h, "alice", ORG, "follow-a"), workerTurn(h, "alice", ORG, "follow-b")]);
    const seeded = await storedRoutines(h, "alice");
    expect(Object.keys(seeded)).toHaveLength(2);
    await workerTurn(h, "alice", ORG, "follow-a");
    expect(await storedRoutines(h, "alice")).toEqual(seeded);
  });

  it("seeds a user's second organization on its own, with none of the first's rows", async () => {
    const h = boot();
    await workerTurn(h, "alice", ORG);
    const first = await storedRoutines(h, "alice", ORG);
    expect(Object.keys(first)).toHaveLength(2);
    expect(await storedRoutines(h, "alice", OTHER_ORG)).toEqual({});
    await workerTurn(h, "alice", OTHER_ORG);
    expect(Object.keys(await storedRoutines(h, "alice", OTHER_ORG)).sort()).toEqual(Object.keys(first).sort());
    expect(await storedRoutines(h, "alice", ORG)).toEqual(first);
  });
});

describe("the routines view and its writes", () => {
  it("shows each caller their own: a second user and a second org, and no session is made to read", async () => {
    const h = boot();
    await workerTurn(h, "alice");
    const pausedId = `clock:${await declaredRoutineKey("weekly-adoption")}`;
    const changed = await clientOf(h, "alice").resource({ scope: "user", pattern: SCHEDULES_PATTERN }).send<{ ok: boolean }>("pauseRoutine", { id: pausedId, paused: true });
    expect(changed).toMatchObject({ ok: true });
    const runtime = await h.state.getRuntime();
    const sessions = async () => (await runtime.stores.session.list({ parentage: "all" } as never)).map((s) => s.id).sort();
    const known = await sessions();

    const view = async (userId: string, orgId: string) => (await clientOf(h, userId, orgId).view(routinesView, {})).value.routines.find((r) => r.id === pausedId);
    expect((await view("alice", ORG))?.paused).toBe(true);
    // Bob in Alice's org, and Alice in another org: the app's routine, unpaused, and listed with no seed.
    expect((await view("bob", ORG))?.paused).toBe(false);
    expect((await view("alice", OTHER_ORG))?.paused).toBe(false);
    expect(await sessions()).toEqual(known);
  });

  it("pauses and deletes through the roster flow's write session, never a roster session, and only the caller's own", async () => {
    const h = boot();
    const alice = clientOf(h, "alice");
    const saved = await alice.resource({ scope: "user", pattern: SCHEDULES_PATTERN }).send<{ ok: boolean; routine: { id: string } }>("saveRoutine", {
      name: "adoption",
      trigger: { clock: { cron: "0 9 * * 1", timezone: "Europe/London" } },
      task: { filer: "lead", goal: "Refresh the adoption numbers", assignee: "eng.tasker" }
    });
    expect(saved.ok).toBe(true);
    // Bob can't reach Alice's routine: his cell has none of that id.
    const bobDelete = await clientOf(h, "bob").resource({ scope: "user", pattern: SCHEDULES_PATTERN }).send<{ ok: boolean; error?: string }>("deleteRoutine", { id: saved.routine.id });
    expect(bobDelete).toMatchObject({ ok: false, error: expect.stringMatching(/^no_routine/) });
    expect(await alice.resource({ scope: "user", pattern: SCHEDULES_PATTERN }).send("deleteRoutine", { id: saved.routine.id })).toEqual({ ok: true });
    expect((await alice.view(routinesView, {})).value.routines.map((r) => r.id)).not.toContain(saved.routine.id);

    const runtime = await h.state.getRuntime();
    const writers = (await runtime.stores.session.list({ parentage: "all" } as never)).filter((s) => s.flowKind === ROSTER_FLOW);
    expect(writers.map((s) => s.userId).sort()).toEqual(["alice", "bob"]);
    for (const session of writers) expect(session.id).toContain("fsd-write.");
  });
});
