/**
 * Goal check — a board drain cannot hand a claimed row to a hired seat its
 * session is outside, on the HTTP router, with no model.
 *
 * See goal.md for the contract, including the source-revert control.
 *
 * Run: pnpm tsx goals/hire-plane/refuses-a-board-drain-onto-a-seat-it-is-outside/run.mts
 */
import {
  defineFlow,
  defineResourceCollection,
  dispatcher,
  handler,
  type FlowInstance,
} from "@flow-state-dev/core";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { taskBoard, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import {
  defineTaskCollection,
  type Task,
  type TaskWorkerInput,
} from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import { loadFixture, runGoal } from "../../lib/index.mts";

type Fixture = {
  ownerOrg: string;
  otherOrg: string;
  ownerUser: string;
  peerUser: string;
  foreignUser: string;
  orgSeat: string;
  privateSeat: string;
  unregisteredSeat: string;
  marker: string;
};

type Who = { user: string; org: string };

const fixture = loadFixture<Fixture>(import.meta.url);
const BOARD_ID = "org-work";
const LEDGER_ID = "org-work-ledger";
const ROWS = { org: "t-org-seat", private: "t-private-seat", ghost: "t-unregistered" } as const;

const verified = {
  resolvePrincipal: (context: { request?: Request }) => {
    const userId = context.request?.headers.get("x-verified-user");
    const orgId = context.request?.headers.get("x-verified-org");
    return userId && orgId ? { userId, orgId } : null;
  },
};

const seen = defineResourceCollection({
  pattern: "seen/*",
  scope: "org",
  stateSchema: z.object({ seat: z.string(), as: z.string(), marker: z.string().nullable() }),
});

/** One org-scoped ledger: the same logical board on the board flow and on the seat. */
const ledger = () => defineTaskCollection({ id: LEDGER_ID, scope: "org" });

/** The seat's worker writes the seat's configured marker, so a run is visible in the store. */
const seatWork = handler({
  name: "seat-work",
  inputSchema: taskWorkerInputSchema,
  outputSchema: z.object({ handled: z.string() }),
  resources: { seen },
  execute: async (input: TaskWorkerInput, ctx) => {
    const seat = (ctx.flow as unknown as { id: string }).id;
    const { userId = "", orgId = "" } = ctx.session.identity;
    await (ctx.resources.seen as unknown as ResourceCollectionRef).create(`${input.taskId}-${userId}`, {
      seat,
      as: `${userId}@${orgId}`,
      marker: (ctx.flow.config as { marker?: string | null }).marker ?? null,
    });
    return { handled: input.taskId };
  },
});

const seatKind = defineFlow({
  kind: "seat",
  cardinality: "collection",
  configSchema: z.object({ marker: z.string().nullable().default(null) }),
  resources: { seen },
  // The seat's own board binds the claim gate on `work`; it holds no rows.
  actions: {
    drain: {
      block: taskBoard({
        name: "seat-board",
        boardId: BOARD_ID,
        collection: ledger(),
        workers: {
          work: dispatcher<TaskWorkerInput>({ name: "seat-hand-off", action: "work", session: "per-task" }),
        },
      }).drain,
    },
  },
  task: { actions: { work: { block: seatWork } } },
  authentication: verified,
});

const seatHandOff = (name: string, flowKind: string) =>
  dispatcher<TaskWorkerInput>({ name, flowKind, action: "work", session: "per-task" });

const orgBoard = taskBoard({
  name: "org-board",
  boardId: BOARD_ID,
  collection: ledger(),
  workers: {
    org: seatHandOff("to-org-seat", fixture.orgSeat),
    private: seatHandOff("to-private-seat", fixture.privateSeat),
    ghost: seatHandOff("to-unregistered-seat", fixture.unregisteredSeat),
  },
  initialTasks: [
    { id: ROWS.org, goal: "org seat work", assignee: "org", input: {} },
    { id: ROWS.private, goal: "private seat work", assignee: "private", input: {} },
    { id: ROWS.ghost, goal: "work for an address nobody holds", assignee: "ghost", input: {} },
  ],
});

const boardFlow = defineFlow({
  kind: "board",
  actions: { start: { block: orgBoard.drain } },
  authentication: verified,
});

const owner: Who = { user: fixture.ownerUser, org: fixture.ownerOrg };
const peer: Who = { user: fixture.peerUser, org: fixture.ownerOrg };
const foreign: Who = { user: fixture.foreignUser, org: fixture.otherOrg };

await runGoal(async () => {
  const failures: string[] = [];
  const fail = (leg: string, line: string) => failures.push(`[${leg}] ${line}`);
  /** A fresh process per leg: the ledger is org-scoped, so a teammate's leg would see the owner's settled rows. */
  const boot = async () => {
    const state = createFlowState({
      flows: { board: boardFlow() },
      resolvePrincipal: verified.resolvePrincipal,
      stores: { default: { primary: inMemoryStores() } },
    });
    state.register(
      seatKind({ id: fixture.orgSeat, config: { marker: fixture.marker } }) as unknown as FlowInstance,
      { pin: { orgId: fixture.ownerOrg } },
    );
    state.register(
      seatKind({ id: fixture.privateSeat, config: { marker: fixture.marker } }) as unknown as FlowInstance,
      { pin: { orgId: fixture.ownerOrg, userId: fixture.ownerUser } },
    );
    const router = (await state.getRouter()) as {
      GET: (request: Request, ctx: { params: { path: string[] } }) => Promise<Response>;
      POST: (request: Request, ctx: { params: { path: string[] } }) => Promise<Response>;
    };
    const runtime = await state.getRuntime();

    const call = async (method: "GET" | "POST", path: string[], who: Who, body?: unknown) => {
      const response = await router[method](
        new Request(`http://goal/api/flows/${path.join("/")}`, {
          method,
          headers: {
            "content-type": "application/json",
            "x-verified-user": who.user,
            "x-verified-org": who.org,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
        { params: { path } },
      );
      const text = await response.text();
      return { status: response.status, json: text.length > 0 ? JSON.parse(text) : undefined };
    };

    const row = async (who: Who, taskId: string) =>
      (await runtime.stores.resourceState.get("org", who.org, `${LEDGER_ID}/${taskId}`))?.state as
        | Task
        | undefined;

    const markers = async (who: Who) =>
      Object.values(await runtime.stores.resourceState.getByPrefix("org", who.org, "seen/"))
        .map((r) => (r as unknown as { state: { seat: string; as: string; marker: string | null } }).state)
        .filter((s) => s.as === `${who.user}@${who.org}`);

    const mintedOn = async (who: Who, seat: string) =>
      (await runtime.stores.session.list({ userId: who.user, parentage: "all" })).filter(
        (record) => record.flowId === seat,
      ).length;

    /** Drain the board over HTTP as `who`, then wait until no handed-off row is in flight. */
    const drain = async (leg: string, who: Who) => {
      const opened = await call("POST", ["board", "sessions"], who, { userId: who.user });
      if (opened.status !== 201) return fail(leg, `board open returned ${opened.status}`);
      const sessionId = opened.json.session.id as string;
      const posted = await call("POST", ["board", sessionId, "actions", "start"], who, {
        userId: who.user,
        input: {},
      });
      if (posted.status !== 202) return fail(leg, `drain returned ${posted.status} ${JSON.stringify(posted.json)}`);
      const requestId = posted.json.request?.id as string;
      let outcome = "timed-out";
      for (let i = 0; i < 200; i++) {
        const status = (await call("GET", ["board", "requests", requestId, "status"], who)).json?.status as
          | string
          | undefined;
        if (status && !["pending", "in_progress", "running", "queued"].includes(status)) {
          outcome = status;
          break;
        }
        await new Promise((r) => setTimeout(r, 5));
      }
      if (outcome !== "completed") fail(leg, `drain request ended ${outcome}`);
      for (let i = 0; i < 100; i++) {
        const rows = await Promise.all([ROWS.org, ROWS.private].map((id) => row(who, id)));
        if (rows.every((r) => r?.status !== "in_progress" && r?.status !== "pending")) break;
        await new Promise((r) => setTimeout(r, 10));
      }
    };

    /** The row was refused before a seat ran it: errored, unheld, nothing minted, no marker. */
    const expectRefused = async (leg: string, who: Who, taskId: string, seat: string) => {
      const settled = await row(who, taskId);
      if (settled?.status !== "errored") fail(leg, `${taskId} ended ${settled?.status}, not errored`);
      if (settled?.claimedBy !== undefined) fail(leg, `${taskId} is still claimed by ${JSON.stringify(settled.claimedBy)}`);
      const minted = await mintedOn(who, seat);
      if (minted > 0) fail(leg, `${minted} session(s) minted on ${seat} for ${who.user}@${who.org}`);
      if ((await markers(who)).some((m) => m.seat === seat)) fail(leg, `${seat} ran for ${who.user}@${who.org}`);
      return settled?.error ?? "";
    };

    return { runtime, row, markers, drain, expectRefused, dispose: () => state.dispose() };
  };

  // (a) The owner's drain hands both rows to both seats, which write the marker.
  const A = await boot();
  await A.drain("a", owner);
  for (const id of [ROWS.org, ROWS.private]) {
    const settled = await A.row(owner, id);
    if (settled?.status !== "completed") fail("a", `owner row ${id} ended ${settled?.status}`);
  }
  const ownerMarkers = await A.markers(owner);
  for (const seat of [fixture.orgSeat, fixture.privateSeat]) {
    if (!ownerMarkers.some((m) => m.seat === seat && m.marker === fixture.marker)) {
      fail("a", `${seat} did not write ${fixture.marker} for the owner`);
    }
  }
  await A.dispose();

  // (b) Another organization's board: both seats refused.
  const B = await boot();
  await B.drain("b", foreign);
  const foreignOrgSeat = await B.expectRefused("b", foreign, ROWS.org, fixture.orgSeat);
  await B.expectRefused("b", foreign, ROWS.private, fixture.privateSeat);
  const acmeMarkersAsForeign = Object.values(
    await B.runtime.stores.resourceState.getByPrefix("org", fixture.ownerOrg, "seen/"),
  ).filter((r) => JSON.stringify(r).includes(fixture.foreignUser));
  if (acmeMarkersAsForeign.length > 0) fail("b", `acme holds a seen row written as ${fixture.foreignUser}`);

  // (c) A teammate's board: the private seat refused, the org seat runs.
  const C = await boot();
  await C.drain("c", peer);
  await C.expectRefused("c", peer, ROWS.private, fixture.privateSeat);
  if ((await C.row(peer, ROWS.org))?.status !== "completed") fail("c", "teammate's org-seat row did not complete");
  if (!(await C.markers(peer)).some((m) => m.seat === fixture.orgSeat && m.marker === fixture.marker)) {
    fail("c", `${fixture.orgSeat} did not run for the teammate`);
  }
  await C.dispose();

  // (d) A seat the caller is outside reads exactly like an address nobody holds.
  const ghost = (await B.row(foreign, ROWS.ghost))?.error ?? "";
  // The seam's own sentence, with the address blanked. The board's prefix names
  // the row and seat, which differ by construction.
  const seamAnswer = (error: string, address: string) =>
    error.slice(error.indexOf("no flow instance")).replaceAll(address, "<address>");
  const asOrg = seamAnswer(foreignOrgSeat, fixture.orgSeat);
  const asGhost = seamAnswer(ghost, fixture.unregisteredSeat);
  if (!ghost.includes(": flow-not-found")) fail("d", `the unregistered address was not refused: ${ghost}`);
  if (asOrg !== asGhost) fail("d", `refusals differ:\n  pinned:       ${asOrg}\n  unregistered: ${asGhost}`);

  await B.dispose();
  const evidence =
    failures.length > 0
      ? ""
      : `owner's drain ran ${fixture.orgSeat} and ${fixture.privateSeat} (marker ${fixture.marker}); ` +
        `${fixture.otherOrg}'s drain errored both rows unheld with no session minted and no marker; ` +
        `the teammate's drain errored the private row and ran the org seat; ` +
        `a pinned-out refusal read the same as ${fixture.unregisteredSeat}: "${foreignOrgSeat}"`;
  return { failures, evidence };
});
