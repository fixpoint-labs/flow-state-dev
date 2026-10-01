/**
 * FIX-1729 · spike POC · one shared project room, several distinct users.
 *
 * NOT production code and not part of any default test run. `run.sh` copies
 * this file into `packages/workforce/test` for one explicit run and removes it.
 * See README.md for the command and the observed output. The harness (real
 * router, verified-header identity, poll helpers) is copied from the FIX-1728
 * POC (`spike/FIX-1728`, `specs/spikes/FIX-1728/poc/resource-talk/`).
 *
 * The question: can one project's talk channel be ONE room that several
 * distinct users read and post in, without turning per-user isolation off?
 *
 * Option B, built here (L2 only, no engine change):
 *
 *   - `projects`    org collection; one row per project. Holds `members`
 *                   (written by the creator) and `nextSeq` (the room's
 *                   sequence counter, advanced under CAS).
 *   - `room-lines`  org collection; ONE ROW PER LINE, keyed `<project>.<seq>`.
 *                   No browser read. This is the room's stream.
 *   - `project-room` each user's own talk session on the room: a view and write
 *                   path. Its `post` and `read` check the caller's server-derived
 *                   `userId` against the project row's `members`.
 *   - `pm-seat`     a seat stand-in. A post wakes it (Soft B shape: dispatcher
 *                   keyed per room) and its answer is appended to the room.
 *
 * Legs:
 *   S1  alice creates "apollo" (members alice, bob); her room view is minted.
 *   S2  bob joins and gets his OWN room view.
 *   S3  alice posts; bob reads it on his own read path (plus the seat's answer).
 *   S4  bob replies; alice reads from her cursor and sees only what is new.
 *   S5  wakes: the seat sessions each post woke belong to the poster.
 *   C1  concurrency: 2 users × 5 posts in parallel land 10 lines, seqs 1..n unique.
 *   N1  negative control: mallory (same org, not a member) cannot join; a view
 *       session she forges with `state.resourceId` cannot read or post; the
 *       collection route refuses her the lines.
 *   RA  red for option A: one room SESSION shared by two users is refused by
 *       today's engine (read, action, session stream all 404 for bob).
 *
 * Control: `POC_NO_GATE=1` removes the membership gate; N1 must go red, which
 * shows the boundary is the L2 gate, not something the engine adds.
 */
import { describe, expect, it } from "vitest";
import {
  defineFlow,
  defineResourceCollection,
  dispatcher,
  handler,
  resourceChangeSchema,
  sequencer
} from "@flow-state-dev/core";
import type { BlockContext, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { z } from "zod";

const ORG = "lab";
const PROJECTS = "projects";
const LINES = "room-lines";
const ROOM_KIND = "project-room";
const SEAT_KIND = "pm-seat";
const NO_GATE = process.env.POC_NO_GATE === "1";

// ---------------------------------------------------------------------------
// Org resources. Durable project data — including the room — lives HERE only.
// ---------------------------------------------------------------------------

const projectRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  ownerUserId: z.string(),
  /** Who may read and post. Written by trusted code, never by the joining caller. */
  members: z.array(z.string()).default([]),
  /** The room's last allocated sequence number. Advanced under CAS. */
  nextSeq: z.number().int().default(0),
  sessions: z.array(z.object({ sessionId: z.string(), userId: z.string() })).default([])
});
type ProjectRow = z.infer<typeof projectRowSchema>;

const lineSchema = z.object({
  projectId: z.string(),
  seq: z.number().int(),
  /** The poster's server-derived user id (the session owner), never a body field. */
  userId: z.string(),
  /** A seat's label when a seat wrote the line; null for a person. */
  author: z.string().nullable().default(null),
  body: z.string()
});
type Line = z.infer<typeof lineSchema>;

const linesCollection = defineResourceCollection({
  pattern: "room-lines/*",
  scope: "org",
  flowIsolation: false,
  // A room grows without bound: never load every line at request start.
  prefetchMode: "lazy",
  stateSchema: lineSchema
  // No `client`: the browser reads lines only through `read`, which checks membership.
});

const mintRoomOnCreate = dispatcher({
  name: "mint-room-on-create",
  flowKind: ROOM_KIND,
  action: "bind",
  inputSchema: resourceChangeSchema(projectRowSchema),
  session: { key: (change) => `room:${change.key}` },
  payload: (change) => ({ resourceId: change.key })
});

const projectsCollection = defineResourceCollection({
  pattern: "projects/*",
  scope: "org",
  flowIsolation: false,
  stateSchema: projectRowSchema,
  client: { state: { read: true }, expose: ["id", "title", "ownerUserId", "members"] },
  reactTo: { created: mintRoomOnCreate }
});

// ---------------------------------------------------------------------------
// The gate and the append — the whole of option B's security and ordering.
// ---------------------------------------------------------------------------

/** The caller's identity, from the session record the engine wrote from the principal. */
const callerOf = (ctx: BlockContext): string => (ctx.session.identity as { userId?: string }).userId ?? "";

/**
 * Load the room this session is bound to and refuse a non-member. Membership is
 * read from the ROW, never from session state: session state is caller-written
 * at create (`session-routes.ts` accepts `body.state`), so a bound `resourceId`
 * proves nothing on its own.
 */
async function memberRoom(ctx: BlockContext, resourceId = (ctx.session.state as { resourceId?: string | null }).resourceId ?? null) {
  if (resourceId === null) throw new Error("room-not-bound");
  const projects = (ctx.resources as Record<string, unknown>)[PROJECTS] as ResourceCollectionRef<ProjectRow>;
  const row = await projects.getOptional(resourceId);
  if (row === undefined) throw new Error(`no project "${resourceId}"`);
  if (!NO_GATE && !row.state.members.includes(callerOf(ctx))) throw new Error("not-a-member");
  return { resourceId, row };
}

/** Allocate the next seq under CAS on the project row, then create the line row at that key. */
async function appendLine(
  ctx: BlockContext,
  row: Awaited<ReturnType<typeof memberRoom>>["row"],
  line: Omit<Line, "seq">
): Promise<number> {
  let seq = 0;
  // The engine's CAS driver retries a conflict 3 times with backoff; under a
  // burst from two posters that budget ran out and a post was lost (README →
  // C1, first run). So the room retries the allocation itself. `POC_NO_RETRY=1`
  // takes this loop out to reproduce the loss.
  const attempts = process.env.POC_NO_RETRY === "1" ? 1 : 8;
  for (let attempt = 1; ; attempt++) {
    try {
      await row.updateState((state) => {
        seq = state.nextSeq + 1; // re-run on a CAS retry; the committed run's value stands
        return { ...state, nextSeq: seq };
      });
      break;
    } catch (error) {
      if (attempt >= attempts || !/concurrent modification/i.test(String((error as Error).message))) throw error;
      await new Promise((r) => setTimeout(r, Math.random() * 20 * attempt));
    }
  }
  const lines = (ctx.resources as Record<string, unknown>)[LINES] as ResourceCollectionRef<Line>;
  // `create`, not `upsert`: two writers can never share a key.
  await lines.create(`${line.projectId}.${String(seq).padStart(8, "0")}`, { ...line, seq });
  return seq;
}

const roomStateSchema = z.object({ resourceId: z.string().nullable().default(null) });
const roomResources = { [PROJECTS]: projectsCollection, [LINES]: linesCollection };

// ---------------------------------------------------------------------------
// The seat stand-in: woken by a post, answers into the room.
// ---------------------------------------------------------------------------

const roomPostSchema = z.object({ projectId: z.string(), seq: z.number(), body: z.string(), wake: z.boolean() });

const onRoomPost = handler({
  name: "on-room-post",
  inputSchema: roomPostSchema,
  outputSchema: z.object({ seq: z.number(), sessionOwner: z.string() }),
  resources: roomResources,
  execute: async (post, ctx) => {
    const projects = ctx.resources[PROJECTS] as ResourceCollectionRef<ProjectRow>;
    const row = await projects.get(post.projectId);
    const seq = await appendLine(ctx as BlockContext, row, {
      projectId: post.projectId,
      userId: callerOf(ctx as BlockContext),
      author: "pm",
      body: `pm: noted line ${post.seq}`
    });
    return { seq, sessionOwner: callerOf(ctx as BlockContext) };
  }
});

const seatFlow = defineFlow({
  kind: SEAT_KIND,
  resources: roomResources,
  actions: {},
  internal: { actions: { onRoomPost: { block: onRoomPost } } }
});

/** Soft B shape: one seat conversation per room, keyed on the room, under the poster's session. */
const wakeSeat = dispatcher({
  name: "wake-pm-seat",
  flowKind: SEAT_KIND,
  action: "onRoomPost",
  inputSchema: roomPostSchema,
  session: { key: (post) => `room:${post.projectId}` }
});

// ---------------------------------------------------------------------------
// The room kind: each user's own session onto the shared room.
// ---------------------------------------------------------------------------

const bind = handler({
  name: "bind",
  inputSchema: z.object({ resourceId: z.string() }),
  outputSchema: z.object({ sessionId: z.string() }),
  sessionStateSchema: roomStateSchema,
  resources: roomResources,
  execute: async (input, ctx) => {
    const bound = (ctx.session.state as { resourceId?: string | null }).resourceId;
    if (bound != null && bound !== input.resourceId) throw new Error(`already bound to "${bound}"`);
    const { row } = await memberRoom(ctx as BlockContext, input.resourceId); // a non-member is refused here
    await ctx.session.patchState({ resourceId: input.resourceId });
    const link = { sessionId: ctx.session.identity.id, userId: callerOf(ctx as BlockContext) };
    await row.updateState((state) =>
      state.sessions.some((s) => s.sessionId === link.sessionId) ? state : { ...state, sessions: [...state.sessions, link] }
    );
    return { sessionId: link.sessionId };
  }
});

const postLine = handler({
  name: "post-line",
  inputSchema: z.object({ body: z.string().min(1), quiet: z.boolean().optional() }),
  outputSchema: roomPostSchema,
  sessionStateSchema: roomStateSchema,
  resources: roomResources,
  execute: async (input, ctx) => {
    const { resourceId, row } = await memberRoom(ctx as BlockContext);
    const seq = await appendLine(ctx as BlockContext, row, {
      projectId: resourceId,
      userId: callerOf(ctx as BlockContext),
      author: null,
      body: input.body
    });
    return { projectId: resourceId, seq, body: input.body, wake: input.quiet !== true };
  }
});

const readLines = handler({
  name: "read-lines",
  inputSchema: z.object({ after: z.number().int().default(0) }),
  outputSchema: z.object({ lines: z.array(lineSchema), cursor: z.number() }),
  sessionStateSchema: roomStateSchema,
  resources: roomResources,
  execute: async (input, ctx) => {
    const { resourceId } = await memberRoom(ctx as BlockContext);
    const lines = ctx.resources[LINES] as ResourceCollectionRef<Line>;
    const refs = await lines.list(`${resourceId}.`);
    const out = refs
      .map((r) => r.state as Line)
      .filter((l) => l.projectId === resourceId && l.seq > input.after)
      .sort((a, b) => a.seq - b.seq);
    return { lines: out, cursor: out.at(-1)?.seq ?? input.after };
  }
});

const roomFlow = defineFlow({
  kind: ROOM_KIND,
  session: { stateSchema: roomStateSchema },
  resources: roomResources,
  actions: {
    post: {
      block: sequencer({ name: "post", inputSchema: z.object({ body: z.string().min(1), quiet: z.boolean().optional() }) })
        .step(postLine)
        .stepIf((out) => out.wake, wakeSeat)
    },
    read: { block: readLines }
  },
  internal: { actions: { bind: { block: bind } } }
});

// ---------------------------------------------------------------------------
// The CoS stand-in: create a project with its members; join one.
// ---------------------------------------------------------------------------

const createProject = handler({
  name: "create-project",
  inputSchema: z.object({ id: z.string(), title: z.string(), members: z.array(z.string()) }),
  outputSchema: z.object({ id: z.string() }),
  resources: roomResources,
  execute: async (input, ctx) => {
    const projects = ctx.resources[PROJECTS] as ResourceCollectionRef<ProjectRow>;
    const owner = callerOf(ctx as BlockContext);
    // The creator is always a member; the rest is the creator's grant.
    const members = [owner, ...input.members.filter((m) => m !== owner)];
    await projects.create(input.id, { id: input.id, title: input.title, ownerUserId: owner, members, nextSeq: 0, sessions: [] });
    return { id: input.id };
  }
});

const joinProject = dispatcher({
  name: "join-project",
  flowKind: ROOM_KIND,
  action: "bind",
  inputSchema: z.object({ id: z.string() }),
  session: { key: (input) => `room:${input.id}` },
  payload: (input) => ({ resourceId: input.id })
});

const cosFlow = defineFlow({
  kind: "cos",
  resources: roomResources,
  actions: {
    createProject: {
      block: sequencer({ name: "create", inputSchema: z.object({ id: z.string(), title: z.string(), members: z.array(z.string()) }) }).step(createProject)
    },
    joinProject: { block: joinProject }
  }
});

// ---------------------------------------------------------------------------
// Harness (from FIX-1728): real router, one org, the user from a verified header.
// ---------------------------------------------------------------------------

type Answer = { status: number; json: any };

async function boot() {
  const state = createFlowState({
    flows: { cos: cosFlow, [ROOM_KIND]: roomFlow, [SEAT_KIND]: seatFlow },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({}),
    // Identity from a verified header, never the body (BP-031). One org.
    resolvePrincipal: (context: any) => {
      const user = context.request?.headers.get("x-verified-user");
      return user == null ? null : { userId: user, orgId: ORG };
    }
  } as never);
  const router = (await state.getRouter()) as any;

  const call = async (method: "GET" | "POST", user: string, path: string[], body?: unknown, query = ""): Promise<Answer> => {
    const response = await router[method](
      new Request(`http://test/api/flows/${path.join("/")}${query}`, {
        method,
        headers: { "content-type": "application/json", "x-verified-user": user },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      }),
      { params: { path } }
    );
    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      await response.body?.cancel();
      return { status: response.status, json: "<event-stream>" };
    }
    const text = await response.text();
    return { status: response.status, json: text.length > 0 ? JSON.parse(text) : undefined };
  };

  const openSession = async (user: string, flow: string, state?: unknown): Promise<string> => {
    const { status, json } = await call("POST", user, [flow, "sessions"], { userId: user, ...(state ? { state } : {}) });
    if (status >= 400) throw new Error(`createSession ${status}: ${JSON.stringify(json)}`);
    return json.session.id;
  };

  const waitFor = async (user: string, flow: string, requestId: string): Promise<string> => {
    for (let i = 0; i < 500; i++) {
      const polled = await call("GET", user, [flow, "requests", requestId, "status"]);
      const seen = polled.json?.status;
      if (["completed", "errored", "failed", "cancelled"].includes(seen)) return seen;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("request never settled");
  };

  const resultOf = async (user: string, sessionId: string, requestId: string) => {
    const { json } = await call("GET", user, ["sessions", sessionId, "requests"], undefined, "?include_result_output=true");
    const found = ((json?.requests ?? []) as Array<Record<string, any>>).find((r) => r.id === requestId) ?? {};
    return { status: found.status as string | undefined, output: found.result?.output, error: found.result?.error };
  };

  /** Run an action on a session and return how it settled, with its output or error. */
  const act = async (user: string, flow: string, sessionId: string, action: string, input: unknown) => {
    const answer = await call("POST", user, [flow, sessionId, "actions", action], { userId: user, input });
    const requestId = answer.json?.request?.id;
    if (requestId === undefined) return { http: answer.status, settled: undefined, output: undefined, error: answer.json };
    const settled = await waitFor(user, flow, requestId);
    const result = await resultOf(user, sessionId, requestId);
    return { http: answer.status, settled, output: result.output, error: result.error };
  };

  const readProjects = async (user: string, sessionId: string) => {
    const { status, json } = await call("GET", user, ["sessions", sessionId, "resources", PROJECTS]);
    if (status !== 200) throw new Error(`read ${status}: ${JSON.stringify(json)}`);
    return (json.items as any[]).map((i) => i.clientData) as Array<Record<string, any>>;
  };

  /** Find `who`'s room view on `project`: a child of their CoS session (minted by the reaction or by join). */
  const linkOf = async (user: string, cosSession: string, project: string, who: string) => {
    for (let i = 0; i < 300; i++) {
      const children = await call("GET", user, ["sessions", cosSession, "children"]);
      const list = (children.json?.sessions ?? children.json?.children ?? []) as Array<{ id: string; flowKind?: string; userId?: string }>;
      for (const c of list) {
        const got = await call("GET", user, ["sessions", c.id]);
        const rec = got.json?.session ?? got.json;
        if (rec?.flowKind === ROOM_KIND && rec?.state?.resourceId === project && rec?.userId === who) return c.id;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`no ${ROOM_KIND} session for ${who} on "${project}"`);
  };

  /** Read the room from `after` until it holds at least `n` new lines (wakes land asynchronously). */
  const readUntil = async (user: string, room: string, after: number, n: number) => {
    let last: any;
    for (let i = 0; i < 300; i++) {
      last = await act(user, ROOM_KIND, room, "read", { after });
      if (last.settled === "completed" && last.output.lines.length >= n) return last.output as { lines: Line[]; cursor: number };
      if (last.settled !== "completed") return last;
      await new Promise((r) => setTimeout(r, 10));
    }
    return last.output;
  };

  return { call, openSession, act, readProjects, linkOf, readUntil };
}

const log = (label: string, value: unknown) => console.log(`[FIX-1729] ${label}: ${JSON.stringify(value)}`);
const brief = (lines: Line[]) => lines.map((l) => `${l.seq}:${l.userId}${l.author ? `/${l.author}` : ""}:${l.body}`);

describe("FIX-1729 · one shared project room (option B, L2 only)", () => {
  it("S1–S5: two users, one room, each on their own read path", async () => {
    const h = await boot();

    // S1 — alice's CoS creates apollo with bob as a member; her room view is minted by the reaction.
    const aliceCos = await h.openSession("alice", "cos");
    const created = await h.act("alice", "cos", aliceCos, "createProject", { id: "apollo", title: "Apollo", members: ["bob"] });
    expect(created.settled).toBe("completed");
    const aliceRoom = await h.linkOf("alice", aliceCos, "apollo", "alice");
    log("S1 project as bob lists it", (await h.readProjects("bob", await h.openSession("bob", "cos"))));

    // S2 — bob joins: his own session on the same room.
    const bobCos = await h.openSession("bob", "cos");
    const joined = await h.act("bob", "cos", bobCos, "joinProject", { id: "apollo" });
    expect(joined.settled).toBe("completed");
    const bobRoom = await h.linkOf("bob", bobCos, "apollo", "bob");
    log("S2 room views", { aliceRoom: aliceRoom.slice(0, 12), bobRoom: bobRoom.slice(0, 12), distinct: aliceRoom !== bobRoom });
    expect(bobRoom).not.toBe(aliceRoom);

    // S3 — alice posts; bob sees it on HIS read path, with the seat's answer.
    const p1 = await h.act("alice", ROOM_KIND, aliceRoom, "post", { body: "kickoff: ship the brief by Friday" });
    expect(p1.settled).toBe("completed");
    const bobView = await h.readUntil("bob", bobRoom, 0, 2);
    log("S3 bob reads (after 0)", brief(bobView.lines));
    expect(bobView.lines[0]).toMatchObject({ seq: 1, userId: "alice", author: null, body: "kickoff: ship the brief by Friday" });
    expect(bobView.lines.some((l: Line) => l.author === "pm")).toBe(true);

    // S4 — bob replies; alice reads from her cursor and gets only what is new.
    const aliceFirst = await h.readUntil("alice", aliceRoom, 0, 2);
    const aliceCursor = aliceFirst.cursor;
    const p2 = await h.act("bob", ROOM_KIND, bobRoom, "post", { body: "on it — draft tonight" });
    expect(p2.settled).toBe("completed");
    const aliceNew = await h.readUntil("alice", aliceRoom, aliceCursor, 2);
    log("S4 alice reads (after cursor)", { cursor: aliceCursor, lines: brief(aliceNew.lines), nextCursor: aliceNew.cursor });
    expect(aliceNew.lines[0]).toMatchObject({ userId: "bob", body: "on it — draft tonight" });
    expect(aliceNew.lines.every((l: Line) => l.seq > aliceCursor)).toBe(true);

    // S5 — wakes: the seat conversation each post woke is a child of the POSTER's room view.
    const seatOf = async (user: string, room: string) => {
      const kids = await h.call("GET", user, ["sessions", room, "children"]);
      const list = (kids.json?.sessions ?? kids.json?.children ?? []) as Array<{ id: string }>;
      const recs = await Promise.all(list.map(async (c) => (await h.call("GET", user, ["sessions", c.id])).json));
      return recs.map((r) => r?.session ?? r).map((r) => ({ flowKind: r.flowKind, userId: r.userId }));
    };
    const seats = { underAlice: await seatOf("alice", aliceRoom), underBob: await seatOf("bob", bobRoom) };
    log("S5 seat sessions woken", seats);
    expect(seats.underAlice).toEqual([{ flowKind: SEAT_KIND, userId: "alice" }]);
    expect(seats.underBob).toEqual([{ flowKind: SEAT_KIND, userId: "bob" }]);

    // C1 — concurrency: two users post 5 lines each, in parallel, quiet (no wakes).
    const before = (await h.readUntil("alice", aliceRoom, 0, 4)).cursor;
    const outcomes: Array<{ body: string; settled?: string; http: number; error?: unknown }> = [];
    const burstOf = (user: string, room: string, tag: string) => async () => {
      for (let i = 0; i < 5; i++) {
        const r = await h.act(user, ROOM_KIND, room, "post", { body: `${tag}${i}`, quiet: true });
        outcomes.push({ body: `${tag}${i}`, settled: r.settled, http: r.http, ...(r.settled === "completed" ? {} : { error: r.error }) });
      }
    };
    await Promise.all([burstOf("alice", aliceRoom, "a")(), burstOf("bob", bobRoom, "b")()]);
    log("C1 post outcomes (not completed)", outcomes.filter((o) => o.settled !== "completed"));
    const burst = await h.readUntil("bob", bobRoom, before, 10);
    const seqs = burst.lines.map((l: Line) => l.seq);
    log("C1 parallel burst", { before, seqs, bodies: burst.lines.map((l: Line) => l.body) });
    expect(burst.lines.length).toBe(10);
    expect(new Set(seqs).size).toBe(10);
    expect(seqs).toEqual(Array.from({ length: 10 }, (_, i) => before + 1 + i));
  }, 60_000);

  it("N1: a user who is not a member cannot read or post (negative control)", async () => {
    const h = await boot();
    const aliceCos = await h.openSession("alice", "cos");
    await h.act("alice", "cos", aliceCos, "createProject", { id: "apollo", title: "Apollo", members: ["bob"] });
    const aliceRoom = await h.linkOf("alice", aliceCos, "apollo", "alice");
    await h.act("alice", ROOM_KIND, aliceRoom, "post", { body: "secret plan", quiet: true });

    // (a) mallory, same org, discovers the project (org-visible, as in FIX-1728) but cannot join.
    const malloryCos = await h.openSession("mallory", "cos");
    const join = await h.act("mallory", "cos", malloryCos, "joinProject", { id: "apollo" });
    // The join's dispatch is asynchronous: its own request settles, and the bind it
    // dispatched is refused in the child. Read what the child holds.
    await new Promise((r) => setTimeout(r, 200));
    const kids = (await h.call("GET", "mallory", ["sessions", malloryCos, "children"])).json;
    const minted = await Promise.all(
      ((kids?.sessions ?? kids?.children ?? []) as Array<{ id: string }>).map(async (c) => {
        const rec = (await h.call("GET", "mallory", ["sessions", c.id])).json;
        return (rec?.session ?? rec)?.state;
      })
    );
    // (b) she forges a room view: session state is caller-written at create.
    const forged = await h.openSession("mallory", ROOM_KIND, { resourceId: "apollo" });
    const forgedRec = (await h.call("GET", "mallory", ["sessions", forged])).json;
    const read = await h.act("mallory", ROOM_KIND, forged, "read", { after: 0 });
    const post = await h.act("mallory", ROOM_KIND, forged, "post", { body: "hi from outside", quiet: true });
    // (c) the generic collection route serves no lines to anyone.
    const direct = await h.call("GET", "mallory", ["sessions", forged, "resources", LINES]);
    // (d) she cannot reach alice's view either (L1 isolation).
    const intoAlices = await h.act("mallory", ROOM_KIND, aliceRoom, "read", { after: 0 });

    log("N1 mallory", {
      join: { request: join.settled, mintedChildState: minted },
      forgedState: (forgedRec?.session ?? forgedRec)?.state,
      read: { settled: read.settled, error: read.error?.message ?? read.error, lines: read.output?.lines?.length },
      post: { settled: post.settled, error: post.error?.message ?? post.error },
      direct: { status: direct.status, body: direct.json },
      intoAlices: intoAlices.http
    });
    expect(minted.every((st) => st?.resourceId == null)).toBe(true); // the join bound nothing
    expect((forgedRec?.session ?? forgedRec)?.state?.resourceId).toBe("apollo"); // the forgery itself lands
    expect(read.settled).not.toBe("completed");
    expect(JSON.stringify(read.error)).toContain("not-a-member");
    expect(post.settled).not.toBe("completed");
    expect(direct.status).toBe(403);
    expect(intoAlices.http).toBe(404);

    // Nothing mallory did reached the room.
    const after = await h.readUntil("alice", aliceRoom, 0, 1);
    log("N1 room as alice sees it", brief(after.lines));
    expect(after.lines.map((l: Line) => l.userId)).toEqual(["alice"]);
  });

  it("RA: option A's shape — one room session shared by two users — is refused by today's engine", async () => {
    const h = await boot();
    const aliceCos = await h.openSession("alice", "cos");
    await h.act("alice", "cos", aliceCos, "createProject", { id: "apollo", title: "Apollo", members: ["bob"] });
    const room = await h.linkOf("alice", aliceCos, "apollo", "alice");
    // bob IS a member by the row, and still cannot use the one room session.
    const read = await h.call("GET", "bob", ["sessions", room]);
    const state = await h.call("GET", "bob", ["sessions", room, "state"]);
    const stream = await h.call("GET", "bob", ["sessions", room, "stream"]);
    const post = await h.call("POST", "bob", [ROOM_KIND, room, "actions", "post"], { userId: "bob", input: { body: "hi", quiet: true } });
    log("RA bob → the one room session", { read: read.status, state: state.status, stream: stream.status, post: post.status, body: post.json });
    expect([read.status, state.status, stream.status, post.status]).toEqual([404, 404, 404, 404]);
  });
});
