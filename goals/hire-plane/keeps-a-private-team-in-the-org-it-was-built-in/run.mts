/**
 * Goal check — a person's private team stays in the organization it was built
 * in: Alice's private Acme seat walked through every door and both halves of
 * its stored-data cell, on the HTTP router and the worker pool, with no model.
 *
 * See goal.md for the contract, including the source-revert controls.
 *
 * Run: pnpm tsx goals/hire-plane/keeps-a-private-team-in-the-org-it-was-built-in/run.mts
 */
import {
  defineFlow,
  defineResourceCollection,
  dispatcher,
  handler,
  type FlowInstance,
} from "@flow-state-dev/core";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import type { JsonObject, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { taskBoard, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import {
  defineTaskCollection,
  type Task,
  type TaskWorkerInput,
} from "@flow-state-dev/orchestration/tasks";
import {
  defineHiredRosterPrivateCollection,
  hiredRosterStorageKey,
  reloadHiredSeats,
  seatAddress,
  toHiredSeatRow,
  workerConfigSchema,
} from "@flow-state-dev/workforce";
import { z } from "zod";
import { loadFixture, runGoal, stripIntentOverrides } from "../../lib/index.mts";

type Fixture = {
  ownerOrg: string;
  otherOrg: string;
  ownerUser: string;
  peerUser: string;
  seatId: string;
  hireInstructions: string;
  marker: string;
};

type Who = { user: string; org: string };

stripIntentOverrides();

const fixture = loadFixture<Fixture>(import.meta.url);
const BOARD_ID = "team-work";
const LEDGER_ID = "team-work-ledger";
const ROW = "t-private-seat";

const verified = {
  resolvePrincipal: (context: { request?: Request }) => {
    const userId = context.request?.headers.get("x-verified-user");
    const orgId = context.request?.headers.get("x-verified-org");
    return userId && orgId ? { userId, orgId } : null;
  },
};

const tagInput = z.object({ tag: z.string() });
const saveInput = z.object({ tag: z.string(), marker: z.string() });

/** The seat's shared user-scoped memory: what the cell holds. */
const notes = defineResourceCollection({
  pattern: "notes/*",
  scope: "user",
  stateSchema: z.object({ marker: z.string() }),
});

/** Org-scoped record of what a run saw or did, so every leg grades a real write. */
const seen = defineResourceCollection({
  pattern: "seen/*",
  scope: "org",
  stateSchema: z.object({
    seat: z.string(),
    as: z.string(),
    notes: z.array(z.string()),
    state: z.string().nullable(),
  }),
});

const whoAmI = (ctx: { session: { identity: { userId?: string; orgId?: string } } }) =>
  `${ctx.session.identity.userId ?? ""}@${ctx.session.identity.orgId ?? ""}`;
const seatOf = (ctx: { flow: unknown }) => (ctx.flow as { id: string }).id;

const save = handler({
  name: "save",
  inputSchema: saveInput,
  outputSchema: z.object({ ok: z.boolean() }),
  resources: { notes, seen },
  execute: async (input, ctx) => {
    await (ctx.resources.notes as unknown as ResourceCollectionRef).create(input.tag, {
      marker: input.marker,
    });
    await ctx.user.patchState({ marker: input.marker });
    return { ok: true };
  },
});

const read = handler({
  name: "read",
  inputSchema: tagInput,
  outputSchema: z.object({ ok: z.boolean() }),
  resources: { notes, seen },
  execute: async (input, ctx) => {
    const rows = await (ctx.resources.notes as unknown as ResourceCollectionRef).list();
    await (ctx.resources.seen as unknown as ResourceCollectionRef).create(input.tag, {
      seat: seatOf(ctx),
      as: whoAmI(ctx),
      notes: rows.map((row) => String((row.state as { marker: string }).marker)),
      state: (ctx.user.state as { marker?: string | null }).marker ?? null,
    });
    return { ok: true };
  },
});

/** A board hand-off onto the seat; it records the run, so a refused one leaves nothing. */
const seatWork = handler({
  name: "seat-work",
  inputSchema: taskWorkerInputSchema,
  outputSchema: z.object({ handled: z.string() }),
  resources: { notes, seen },
  execute: async (input: TaskWorkerInput, ctx) => {
    await (ctx.resources.seen as unknown as ResourceCollectionRef).create(`drain-${input.taskId}`, {
      seat: seatOf(ctx),
      as: whoAmI(ctx),
      notes: [],
      state: null,
    });
    return { handled: input.taskId };
  },
});

const ledger = () => defineTaskCollection({ id: LEDGER_ID, scope: "org" });

const seatKind = defineFlow({
  kind: "research",
  cardinality: "collection",
  configSchema: workerConfigSchema(),
  resources: { notes, seen },
  user: { stateSchema: z.object({ marker: z.string().nullable().default(null) }) },
  actions: {
    save: { inputSchema: saveInput, block: save },
    read: { inputSchema: tagInput, block: read },
    // The seat's own board binds the claim gate on `work`; it holds no rows.
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

const ownerSeat = seatAddress(fixture.ownerOrg, fixture.seatId, fixture.ownerUser);
const ownerOtherOrgSeat = seatAddress(fixture.otherOrg, fixture.seatId, fixture.ownerUser);
const peerSeat = seatAddress(fixture.ownerOrg, fixture.seatId, fixture.peerUser);

const boardFlow = defineFlow({
  kind: "board",
  actions: {
    start: {
      block: taskBoard({
        name: "team-board",
        boardId: BOARD_ID,
        collection: ledger(),
        workers: {
          private: dispatcher<TaskWorkerInput>({
            name: "to-private-seat",
            flowKind: ownerSeat,
            action: "work",
            session: "per-task",
          }),
        },
        initialTasks: [{ id: ROW, goal: "work for the owner's private seat", assignee: "private", input: {} }],
      }).drain,
    },
  },
  authentication: verified,
});

const privateRoster = defineHiredRosterPrivateCollection();

/** Hires a private `research` seat for the session's user, through the branded writer. */
const hire = handler({
  name: "hire",
  inputSchema: z.object({}),
  outputSchema: z.object({ ok: z.boolean() }),
  resources: { privateRoster },
  execute: async (_input, ctx) => {
    const { userId = "", orgId = "" } = ctx.session.identity;
    const row = toHiredSeatRow({
      seatId: fixture.seatId,
      flow: "research",
      instructions: userId === fixture.ownerUser && orgId === fixture.ownerOrg ? fixture.hireInstructions : null,
      owningOrgId: orgId,
      ownerUserId: userId,
    });
    const [owner, seat] = hiredRosterStorageKey(row).split("/");
    await (ctx.resources.privateRoster as unknown as ResourceCollectionRef).create(
      { owner: owner!, seat: seat! },
      row as unknown as JsonObject,
    );
    return { ok: true };
  },
});

const appFlow = defineFlow({
  kind: "app",
  resources: { privateRoster },
  actions: { hire: { inputSchema: z.object({}), block: hire } },
  authentication: verified,
});

const owner: Who = { user: fixture.ownerUser, org: fixture.ownerOrg };
const ownerElsewhere: Who = { user: fixture.ownerUser, org: fixture.otherOrg };
const peer: Who = { user: fixture.peerUser, org: fixture.ownerOrg };
const outsiders: Array<[string, Who]> = [
  [`${ownerElsewhere.user}@${ownerElsewhere.org}`, ownerElsewhere],
  [`${peer.user}@${peer.org}`, peer],
];

await runGoal(async () => {
  const failures: string[] = [];
  const fail = (leg: string, line: string) => failures.push(`[${leg}] ${line}`);
  const state = createFlowState({
    flows: { app: appFlow(), board: boardFlow() },
    resolvePrincipal: verified.resolvePrincipal,
    stores: { default: { primary: inMemoryStores() } },
    // What `fsdev dev` does; leg (g) only exists with it on.
    debugEndpointsEnabled: true,
  });
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
    let json: any;
    try {
      json = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    return { status: response.status, text, json };
  };

  const open = (who: Who, flowId: string) => call("POST", [flowId, "sessions"], who, { userId: who.user });

  /** POST an action, then wait for the request to settle. `sessionId` undefined = session-less. */
  const act = async (who: Who, flowId: string, sessionId: string | undefined, action: string, input: unknown) => {
    const path = sessionId === undefined ? [flowId, "actions", action] : [flowId, sessionId, "actions", action];
    const posted = await call("POST", path, who, { userId: who.user, input });
    if (posted.status >= 400) return { http: posted.status, outcome: undefined as string | undefined };
    const requestId = posted.json.request?.id as string;
    for (let i = 0; i < 300; i++) {
      const status = (await call("GET", [flowId, "requests", requestId, "status"], who)).json?.status as
        | string
        | undefined;
      if (status && !["pending", "in_progress", "running", "queued"].includes(status)) {
        return { http: posted.status, outcome: status };
      }
      await new Promise((r) => setTimeout(r, 5));
    }
    return { http: posted.status, outcome: "timed-out" };
  };

  const seenRow = async (org: string, tag: string) =>
    (await runtime.stores.resourceState.get("org", org, `seen/${tag}`))?.state as
      | { seat: string; as: string; notes: string[]; state: string | null }
      | undefined;

  /** A fresh session on `flowId`, a `read`, and what that run saw. */
  const readAs = async (leg: string, who: Who, flowId: string, tag: string) => {
    const opened = await open(who, flowId);
    if (opened.status !== 201) {
      fail(leg, `${who.user}@${who.org} could not open ${flowId}: ${opened.status}`);
      return undefined;
    }
    const ran = await act(who, flowId, opened.json.session.id as string, "read", { tag });
    if (ran.outcome !== "completed") fail(leg, `read on ${flowId} ended ${JSON.stringify(ran)}`);
    const row = await seenRow(who.org, tag);
    if (row === undefined) fail(leg, `read on ${flowId} recorded nothing`);
    return row;
  };

  const sawMarker = (row: { notes: string[]; state: string | null } | undefined) =>
    row !== undefined && (row.notes.includes(fixture.marker) || row.state === fixture.marker);

  // Setup: each person hires a private `research` seat in their org through
  // the app, and the host reloads the roster and registers every seat under
  // the pin copied from its row — the path a restart takes.
  for (const who of [owner, ownerElsewhere, peer]) {
    const session = await open(who, "app");
    const hired = session.status === 201 ? await act(who, "app", session.json.session.id, "hire", {}) : undefined;
    if (hired?.outcome !== "completed") fail("setup", `${who.user}@${who.org} hire ended ${JSON.stringify(hired)}`);
  }
  const reloaded = await reloadHiredSeats({
    stores: runtime.stores,
    orgIds: [fixture.ownerOrg, fixture.otherOrg],
    kinds: { research: seatKind },
  });
  if (reloaded.problems.length > 0) fail("setup", `reload problems: ${reloaded.problems.join("; ")}`);
  for (const seat of reloaded.seats) {
    const pin = (seat as FlowInstance).ownerPin;
    state.register(seat as FlowInstance, pin === undefined ? undefined : { pin });
  }
  const minted = reloaded.seats.map((seat) => seat.id).sort();
  const expected = [ownerSeat, ownerOtherOrgSeat, peerSeat].sort();
  if (JSON.stringify(minted) !== JSON.stringify(expected)) {
    fail("setup", `reload minted ${JSON.stringify(minted)}, expected ${JSON.stringify(expected)}`);
    return { failures, evidence: "" };
  }

  // (a) The owner opens her private seat and saves the marker to a shared
  // user resource and to her user state.
  const ownerOpen = await open(owner, ownerSeat);
  const ownerSession = ownerOpen.status === 201 ? (ownerOpen.json.session.id as string) : undefined;
  if (ownerSession === undefined) fail("a", `owner open returned ${ownerOpen.status}`);
  else {
    const saved = await act(owner, ownerSeat, ownerSession, "save", { tag: "saved", marker: fixture.marker });
    if (saved.outcome !== "completed") fail("a", `owner save ended ${JSON.stringify(saved)}`);
  }

  // (b) The catalog lists the seat for the owner only.
  const listed = async (who: Who) =>
    ((await call("GET", [], who)).json?.flows ?? []).map((flow: { id: string }) => flow.id) as string[];
  if (!(await listed(owner)).includes(ownerSeat)) fail("b", "the owner's catalog omitted her seat");
  for (const [name, who] of outsiders) {
    if ((await listed(who)).includes(ownerSeat)) fail("b", `${name}'s catalog listed ${ownerSeat}`);
  }

  for (const [name, who] of outsiders) {
    // (c) Opening it is 404.
    const opened = await open(who, ownerSeat);
    if (opened.status !== 404) fail("c", `${name} opened ${ownerSeat} as ${opened.status}`);
    // (d) Running an action on it is 404.
    const ran = await act(who, ownerSeat, undefined, "read", { tag: `run-${who.user}-${who.org}` });
    if (ran.http !== 404) fail("d", `${name} ran an action on ${ownerSeat}: ${JSON.stringify(ran)}`);
    // (e) Resuming the owner's session is refused.
    if (ownerSession !== undefined) {
      const resumed = await act(who, ownerSeat, ownerSession, "read", { tag: `resume-${who.user}-${who.org}` });
      if (resumed.http < 400) fail("e", `${name} resumed the owner's session: ${JSON.stringify(resumed)}`);
    }
    for (const tag of [`run-${who.user}-${who.org}`, `resume-${who.user}-${who.org}`]) {
      for (const org of [fixture.ownerOrg, fixture.otherOrg]) {
        if ((await seenRow(org, tag)) !== undefined) fail("d/e", `${name}'s refused call still ran (${tag})`);
      }
    }
  }

  // (f) A board in each outsider's org, drained by that outsider, onto the
  // seat: the row ends errored and unheld, and no session is minted.
  for (const [name, who] of outsiders) {
    const board = await open(who, "board");
    if (board.status !== 201) {
      fail("f", `${name} could not open the board: ${board.status}`);
      continue;
    }
    const drained = await act(who, "board", board.json.session.id as string, "start", {});
    if (drained.outcome !== "completed") fail("f", `${name}'s drain ended ${JSON.stringify(drained)}`);
    let row: Task | undefined;
    for (let i = 0; i < 100; i++) {
      row = (await runtime.stores.resourceState.get("org", who.org, `${LEDGER_ID}/${ROW}`))?.state as Task | undefined;
      if (row !== undefined && row.status !== "in_progress" && row.status !== "pending") break;
      await new Promise((r) => setTimeout(r, 10));
    }
    if (row?.status !== "errored") fail("f", `${name}'s row ended ${row?.status}, not errored`);
    if (row?.claimedBy !== undefined) fail("f", `${name}'s row is still claimed by ${JSON.stringify(row.claimedBy)}`);
    const sessions = await runtime.stores.session.list({ userId: who.user, parentage: "all" });
    // Same person in another org is still an outsider: count by (user, org).
    const onSeat = sessions.filter((record) => record.flowId === ownerSeat && record.orgId === who.org).length;
    if (onSeat > 0) fail("f", `${onSeat} session(s) minted on ${ownerSeat} for ${name}`);
    if ((await seenRow(who.org, `drain-${ROW}`)) !== undefined) fail("f", `the seat ran ${name}'s hand-off`);
  }

  // (g) With debug endpoints on, neither outsider's debug listing shows the
  // owner's private roster row; the owner's own listing does.
  const debugBody = async (who: Who) => {
    const session = await open(who, "app");
    if (session.status !== 201) return { ok: false, body: "" };
    const base = ["sessions", session.json.session.id as string, "debug", "resources"];
    const tree = await call("GET", base, who);
    const items = await call("GET", [...base, "privateRoster", "items"], who);
    return { ok: tree.status === 200 && items.status === 200, body: tree.text + items.text };
  };
  const ownerDebug = await debugBody(owner);
  if (!ownerDebug.ok || !ownerDebug.body.includes(fixture.hireInstructions)) {
    fail("g", "the owner's debug listing did not show her private roster row");
  }
  for (const [name, who] of outsiders) {
    const debug = await debugBody(who);
    if (!debug.ok) fail("g", `${name}'s debug reads were not all 200`);
    if (debug.body.includes(fixture.hireInstructions)) fail("g", `${name}'s debug listing showed the owner's private row`);
  }

  // (h) The owner's next run on her seat reads the marker back.
  const back = await readAs("h", owner, ownerSeat, "owner-again");
  if (back !== undefined && !(back.notes.includes(fixture.marker) && back.state === fixture.marker)) {
    fail("h", `the owner's next run read ${JSON.stringify(back)}, not ${fixture.marker} in notes and state`);
  }

  // (i) Alice's own Globex seat of the same kind reads no marker.
  const elsewhere = await readAs("i", ownerElsewhere, ownerOtherOrgSeat, "owner-in-other-org");
  if (sawMarker(elsewhere)) fail("i", `${ownerOtherOrgSeat} read ${JSON.stringify(elsewhere)}`);

  // (j) Bob's Acme seat of the same kind reads no marker.
  const peers = await readAs("j", peer, peerSeat, "peer");
  if (sawMarker(peers)) fail("j", `${peerSeat} read ${JSON.stringify(peers)}`);

  await state.dispose();
  const evidence =
    failures.length > 0
      ? ""
      : `${fixture.ownerUser}@${fixture.ownerOrg} saved ${fixture.marker} at ${ownerSeat}. ` +
        `For ${outsiders.map(([name]) => name).join(" and ")}: not listed, open 404, run 404, resume refused, ` +
        `drain errored unheld with no session minted, debug listing without the private row. ` +
        `The owner's next run read ${fixture.marker} from notes and state; ` +
        `${ownerOtherOrgSeat} read ${JSON.stringify(elsewhere)}; ${peerSeat} read ${JSON.stringify(peers)}.`;
  return { failures, evidence };
});
