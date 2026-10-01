/**
 * FIX-1728 · spike POC · a resource-backed talk channel, end to end.
 *
 * NOT production code and not part of any default test run. `run.sh` copies
 * this file into `packages/workforce/test` for one explicit run and removes it.
 * See README.md for the command and the observed output.
 *
 * The question: can a Chief-of-Staff-like seat create an org-discoverable
 * project record at runtime, and have a talk session minted for it from a
 * template, with the link explicit on both sides — using only what L1 already
 * offers? Everything under test is the real engine: `createFlowState`, its HTTP
 * router, the session/action/resource-read routes, route auth, the dispatch
 * seam and the reactive-block dispatcher. The two flows below are sketches of
 * the L2 pieces the convention would generate:
 *
 *   - `cos`          stands in for the CoS seat: it writes the project row.
 *   - `project-talk` stands in for a talk channel kind that can be minted at
 *                    runtime: it has an internal `bind` entry, which today's
 *                    built-in channel kind does not (leg R1 shows why it must).
 *
 * The mint itself is NOT a call anyone makes. It is `reactTo.created` on the
 * project collection (an existing L1 hook) holding a cross-flow `dispatcher`
 * with a `{ key }` session (an existing L1 seam).
 *
 * Legs:
 *   P1  alice's CoS creates "apollo": the row lands, a talk session is minted
 *       for it, the session carries `resourceId`, the row lists the session.
 *   P2  bob, same org, discovers "apollo" through the collection read route.
 *   P3  bob cannot reach alice's talk session: read is 404, an action is refused.
 *   P4  bob joins: his OWN talk session is minted and listed beside alice's.
 *   P5  durable project data is read from the resource, not the session.
 *   P6  one person's flow cannot deliver into another person's talk session
 *       (`{ id }` dispatch is refused across principals), so a post cannot be
 *       fanned out from alice's session into bob's.
 *   R1  red: the built-in channel kind minted the same way is unbound, and its
 *       post refuses `channel-not-bound`.
 *   R2  red: a `CHANNEL.md` cannot carry `resourceId` today (closed key list).
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
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { z } from "zod";
import { CHANNEL_KIND, channelFlow, channelInstances } from "../src/index";

const ORG = "lab";
const PROJECTS = "projects";
const TALK_KIND = "project-talk";

// ---------------------------------------------------------------------------
// The org resource: one row per project. Durable project data lives HERE only.
// ---------------------------------------------------------------------------

const sessionLinkSchema = z.object({ sessionId: z.string(), userId: z.string() });

const projectRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(["active", "done"]).default("active"),
  ownerUserId: z.string(),
  /** The resource's side of the link: every talk session minted for it. */
  sessions: z.array(sessionLinkSchema).default([])
});
type ProjectRow = z.infer<typeof projectRowSchema>;

/**
 * The mint. A reactive block bound to `created`: it runs inside the turn that
 * created the row, under that turn's principal, and dispatches the talk kind's
 * `bind` into a child session keyed on the resource id.
 */
const mintTalkOnCreate = dispatcher({
  name: "mint-talk-on-create",
  flowKind: TALK_KIND,
  action: "bind",
  inputSchema: resourceChangeSchema(projectRowSchema),
  session: { key: (change) => `talk:${change.key}` },
  payload: (change) => ({ resourceId: change.key })
});

/** Control (README → "Control"): `POC_NO_REACT=1` drops the `reactTo` binding. P1 must go red. */
const NO_REACT = process.env.POC_NO_REACT === "1";

const projectsCollection = defineResourceCollection({
  pattern: "projects/*",
  scope: "org",
  flowIsolation: false,
  stateSchema: projectRowSchema,
  client: { state: { read: true }, expose: ["id", "title", "status", "ownerUserId", "sessions"] },
  ...(NO_REACT ? {} : { reactTo: { created: mintTalkOnCreate } })
});

// ---------------------------------------------------------------------------
// The talk kind: a session ABOUT a resource. Its only project fact is the id.
// ---------------------------------------------------------------------------

const talkStateSchema = z.object({ resourceId: z.string().nullable().default(null) });

/**
 * `bind` — internal only. Writes the session's side of the link, then lists the
 * session on the resource. Refuses a resource that does not exist and a session
 * already bound to a different one.
 */
const bind = handler({
  name: "bind",
  inputSchema: z.object({ resourceId: z.string() }),
  outputSchema: z.object({ sessionId: z.string() }),
  sessionStateSchema: talkStateSchema,
  resources: { [PROJECTS]: projectsCollection },
  execute: async (input, ctx) => {
    const bound = (ctx.session.state as { resourceId?: string | null }).resourceId;
    if (bound != null && bound !== input.resourceId) {
      throw new Error(`talk session already bound to "${bound}"`);
    }
    const projects = ctx.resources[PROJECTS] as ResourceCollectionRef<ProjectRow>;
    const row = await projects.getOptional(input.resourceId);
    if (row === undefined) throw new Error(`no project "${input.resourceId}"`);

    await ctx.session.patchState({ resourceId: input.resourceId });
    const link = { sessionId: ctx.session.identity.id, userId: ctx.session.identity.userId ?? "" };
    await row.updateState((state) =>
      state.sessions.some((s) => s.sessionId === link.sessionId)
        ? state
        : { ...state, sessions: [...state.sessions, link] }
    );
    return { sessionId: link.sessionId };
  }
});

/** `about` — what the talk session is about, read from the RESOURCE. */
const about = handler({
  name: "about",
  outputSchema: z.object({ resourceId: z.string().nullable(), title: z.string().nullable() }),
  sessionStateSchema: talkStateSchema,
  resources: { [PROJECTS]: projectsCollection },
  execute: async (_input, ctx) => {
    const resourceId = (ctx.session.state as { resourceId?: string | null }).resourceId ?? null;
    if (resourceId === null) throw new Error("talk session is not bound to a resource");
    const projects = ctx.resources[PROJECTS] as ResourceCollectionRef<ProjectRow>;
    const row = await projects.getOptional(resourceId);
    return { resourceId, title: row?.state.title ?? null };
  }
});

const talkFlow = defineFlow({
  kind: TALK_KIND,
  session: { stateSchema: talkStateSchema },
  resources: { [PROJECTS]: projectsCollection },
  actions: { about: { block: about } },
  internal: { actions: { bind: { block: bind } } }
});

// ---------------------------------------------------------------------------
// The CoS stand-in: create a project; join one; and R1's mint of the built-in.
// ---------------------------------------------------------------------------

const createProject = handler({
  name: "create-project",
  inputSchema: z.object({ id: z.string(), title: z.string() }),
  outputSchema: z.object({ id: z.string() }),
  resources: { [PROJECTS]: projectsCollection },
  execute: async (input, ctx) => {
    const projects = ctx.resources[PROJECTS] as ResourceCollectionRef<ProjectRow>;
    // `create`, not `upsert`: a second create of one id is refused, not merged.
    await projects.create(input.id, {
      id: input.id,
      title: input.title,
      status: "active",
      ownerUserId: ctx.session.identity.userId ?? "",
      sessions: []
    });
    return { id: input.id };
  }
});

/** Join: mint the CALLER's own talk session for an existing project. */
const joinProject = dispatcher({
  name: "join-project",
  flowKind: TALK_KIND,
  action: "bind",
  inputSchema: z.object({ id: z.string() }),
  session: { key: (input) => `talk:${input.id}` },
  payload: (input) => ({ resourceId: input.id })
});

/**
 * P6: deliver into an EXISTING talk session by id — the only way one person's
 * line could reach another person's session (the shape Soft B uses for seats).
 */
const deliverInto = dispatcher({
  name: "deliver-into",
  flowKind: TALK_KIND,
  action: "bind",
  inputSchema: z.object({ sessionId: z.string(), id: z.string() }),
  session: { id: (input) => input.sessionId },
  payload: (input) => ({ resourceId: input.id })
});

/** R1: the built-in channel kind, minted exactly the way the talk kind is. */
const mintBuiltinChannel = dispatcher({
  name: "mint-builtin-channel",
  flowKind: CHANNEL_KIND,
  action: "post",
  inputSchema: z.object({ id: z.string() }),
  session: { key: (input) => `builtin:${input.id}` },
  payload: () => ({ body: "first line in a minted built-in channel" })
});

const cosFlow = defineFlow({
  kind: "cos",
  resources: { [PROJECTS]: projectsCollection },
  actions: {
    createProject: { block: sequencer({ name: "create", inputSchema: z.object({ id: z.string(), title: z.string() }) }).step(createProject) },
    joinProject: { block: joinProject },
    deliverInto: { block: deliverInto },
    mintBuiltinChannel: { block: mintBuiltinChannel }
  }
});

// ---------------------------------------------------------------------------
// Harness: real router, one org, the user from a verified header.
// ---------------------------------------------------------------------------

type Answer = { status: number; json: any };

async function boot() {
  const state = createFlowState({
    flows: { cos: cosFlow, [TALK_KIND]: talkFlow, [CHANNEL_KIND]: channelFlow },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({}),
    // Identity from a verified header, never the body (BP-031). One org.
    resolvePrincipal: (context) => {
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
    const text = await response.text();
    return { status: response.status, json: text.length > 0 ? JSON.parse(text) : undefined };
  };

  const openSession = async (user: string, flow: string): Promise<string> => {
    const { status, json } = await call("POST", user, [flow, "sessions"], { userId: user });
    if (status >= 400) throw new Error(`createSession ${status}: ${JSON.stringify(json)}`);
    return json.session.id;
  };

  const waitFor = async (user: string, flow: string, requestId: string): Promise<{ status: string; body: any }> => {
    for (let i = 0; i < 300; i++) {
      const polled = await call("GET", user, [flow, "requests", requestId, "status"]);
      const seen = polled.json?.status;
      if (["completed", "errored", "failed", "cancelled"].includes(seen)) return { status: seen, body: polled.json };
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("request never settled");
  };

  const act = async (user: string, flow: string, sessionId: string, action: string, input: unknown) => {
    const answer = await call("POST", user, [flow, sessionId, "actions", action], { userId: user, input });
    const requestId = answer.json?.request?.id;
    const final = requestId === undefined ? undefined : await waitFor(user, flow, requestId);
    return { ...answer, settled: final?.status, final: final?.body };
  };

  const readProjects = async (user: string, sessionId: string): Promise<Array<Record<string, any>>> => {
    const { status, json } = await call("GET", user, ["sessions", sessionId, "resources", PROJECTS]);
    if (status !== 200) throw new Error(`read ${status}: ${JSON.stringify(json)}`);
    return json.items.map((i: any) => i.clientData);
  };

  /** Poll the row until `n` sessions are listed (the bind is a separate request). */
  const sessionsOn = async (user: string, sessionId: string, id: string, n: number) => {
    for (let i = 0; i < 300; i++) {
      const row = (await readProjects(user, sessionId)).find((p) => p.id === id);
      if (row !== undefined && row.sessions.length >= n) return row.sessions as Array<{ sessionId: string; userId: string }>;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`"${id}" never listed ${n} session(s)`);
  };

  /** One request on a session, with its result (output or error). */
  const resultOf = async (user: string, sessionId: string, requestId: string) => {
    const { json } = await call("GET", user, ["sessions", sessionId, "requests"], undefined, "?include_result_output=true");
    const requests = (json?.requests ?? []) as Array<Record<string, any>>;
    const found = requests.find((r) => r.id === requestId) ?? {};
    return { status: found.status, result: found.result };
  };

  return { call, openSession, act, readProjects, sessionsOn, resultOf };
}

const log = (label: string, value: unknown) => console.log(`[FIX-1728] ${label}: ${JSON.stringify(value)}`);

describe("FIX-1728 · resource-backed talk channel", () => {
  it("P1–P5: create → mint → link both ways → org discovery → per-user participation", async () => {
    const h = await boot();

    // P1 — alice's CoS creates the project.
    const aliceCos = await h.openSession("alice", "cos");
    const created = await h.act("alice", "cos", aliceCos, "createProject", { id: "apollo", title: "Apollo" });
    log("P1 create", { status: created.status, settled: created.settled });
    expect(created.settled).toBe("completed");

    const [aliceLink] = await h.sessionsOn("alice", aliceCos, "apollo", 1);
    log("P1 resource.sessions", [aliceLink]);
    expect(aliceLink!.userId).toBe("alice");

    const aliceTalk = await h.call("GET", "alice", ["sessions", aliceLink!.sessionId]);
    const talkRecord = aliceTalk.json?.session ?? aliceTalk.json;
    log("P1 talk session (alice)", {
      status: aliceTalk.status,
      flowKind: talkRecord?.flowKind,
      userId: talkRecord?.userId,
      orgId: talkRecord?.orgId,
      parentSessionId: talkRecord?.parentSessionId,
      state: talkRecord?.state
    });
    expect(aliceTalk.status).toBe(200);
    expect(talkRecord.state.resourceId).toBe("apollo");
    expect(talkRecord.userId).toBe("alice");

    // P2 — bob, same org, discovers it from a session of his own.
    const bobCos = await h.openSession("bob", "cos");
    const seenByBob = await h.readProjects("bob", bobCos);
    log("P2 bob reads projects", seenByBob);
    expect(seenByBob.map((p) => p.id)).toEqual(["apollo"]);

    // P3 — bob cannot reach alice's talk session.
    const bobRead = await h.call("GET", "bob", ["sessions", aliceLink!.sessionId]);
    const bobAct = await h.act("bob", TALK_KIND, aliceLink!.sessionId, "about", {});
    log("P3 bob → alice's talk session", { read: bobRead.status, readBody: bobRead.json, action: bobAct.status, actionBody: bobAct.json, settled: bobAct.settled });
    expect(bobRead.status).toBe(404);
    expect(bobAct.settled === "completed").toBe(false);

    // P4 — bob joins: his own session, listed beside alice's.
    const joined = await h.act("bob", "cos", bobCos, "joinProject", { id: "apollo" });
    expect(joined.settled).toBe("completed");
    const links = await h.sessionsOn("bob", bobCos, "apollo", 2);
    log("P4 resource.sessions after bob joins", links);
    expect(links.map((l) => l.userId).sort()).toEqual(["alice", "bob"]);
    const bobLink = links.find((l) => l.userId === "bob")!;
    expect(bobLink.sessionId).not.toBe(aliceLink!.sessionId);

    // P5 — each talk session answers "what am I about" from the resource.
    const aboutAlice = await h.act("alice", TALK_KIND, aliceLink!.sessionId, "about", {});
    const aboutBob = await h.act("bob", TALK_KIND, bobLink.sessionId, "about", {});
    const aliceAbout = await h.resultOf("alice", aliceLink!.sessionId, aboutAlice.json.request.id);
    const bobAbout = await h.resultOf("bob", bobLink.sessionId, aboutBob.json.request.id);
    log("P5 about (alice)", aliceAbout);
    log("P5 about (bob)", bobAbout);
    expect(JSON.stringify(aliceAbout)).toContain("Apollo");
    expect(JSON.stringify(bobAbout)).toContain("Apollo");

    // P6 — a dispatch into another person's talk session is refused; into one's own, delivered.
    const own = await h.act("alice", "cos", aliceCos, "deliverInto", { sessionId: aliceLink!.sessionId, id: "apollo" });
    const cross = await h.act("bob", "cos", bobCos, "deliverInto", { sessionId: aliceLink!.sessionId, id: "apollo" });
    const crossResult = await h.resultOf("bob", bobCos, cross.json.request.id);
    log("P6 deliver into a talk session by id", { alicesOwn: own.settled, bobIntoAlices: cross.settled, error: crossResult.result?.error });
    expect(own.settled).toBe("completed");
    expect(cross.settled).not.toBe("completed");
    expect(JSON.stringify(crossResult)).toMatch(/session-not-found|session-not-addressable/);
    expect(aboutAlice.settled).toBe("completed");
    expect(aboutBob.settled).toBe("completed");
  });

  it("R1: the built-in channel kind, minted at runtime the same way, is unbound", async () => {
    const h = await boot();
    const aliceCos = await h.openSession("alice", "cos");
    const minted = await h.act("alice", "cos", aliceCos, "mintBuiltinChannel", { id: "apollo" });
    expect(minted.settled).toBe("completed");

    // The dispatch minted a child of alice's CoS session on the built-in kind.
    const children = await h.call("GET", "alice", ["sessions", aliceCos, "children"]);
    const listed = (children.json?.sessions ?? children.json?.children ?? []) as Array<{ id: string }>;
    log("R1 children of alice's CoS session", { status: children.status, ids: listed.map((c) => c.id) });
    expect(listed.length).toBe(1);
    const fetched = await h.call("GET", "alice", ["sessions", listed[0]!.id]);
    const child = { id: listed[0]!.id, ...(fetched.json?.session ?? fetched.json) };
    log("R1 minted built-in channel session", { flowKind: child.flowKind, state: child.state });
    // Empty state: no members, no charter — exactly what `channel-not-bound` tests.
    expect(child!.state ?? {}).not.toHaveProperty("members");

    // A direct post into it is refused the way the internal one was.
    const post = await h.act("alice", CHANNEL_KIND, child.id, "post", { body: "hello" });
    const refused = await h.resultOf("alice", child.id, post.json.request.id);
    log("R1 post into minted built-in", { settled: post.settled, last: refused });
    expect(post.settled).not.toBe("completed");
    expect(JSON.stringify(refused)).toContain("not an open channel");
  });

  it("R2: a CHANNEL.md cannot carry resourceId today (closed key list)", () => {
    let message = "";
    try {
      channelInstances([{ id: "org.apollo", declared: { resourceId: "apollo" }, body: "" }]);
    } catch (error) {
      message = (error as Error).message;
    }
    log("R2 channelInstances refusal", message);
    expect(message).toMatch(/resourceId/);
  });
});
