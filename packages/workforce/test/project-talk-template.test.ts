/**
 * A project's talk template, and the wakes a post in a project's room makes.
 *
 * The binder half reads templates from both sites (the org-level default
 * beside the projects collection, and a team `CHANNEL.md` marked `mintFor:`),
 * refuses the bad ones all together at boot, builds the template onto the kind,
 * and installs the reaction that mints a creator's talk session on create.
 * The runtime half runs over the real HTTP router as verified users, with
 * listening seats from two teams standing in for the template's seats.
 *
 * Checks, by the plan's V3:
 *   · create mints in the same turn, and both sides of the link agree; with no
 *     template (the negative control) nothing mints
 *   · outside a turn, nothing mints
 *   · a post wakes each seat once, under the poster, keyed per room, with the
 *     room's recent lines, and a seat's answer lands in the room for everyone
 *   · a seat edit plus a restart reaches an existing talk session
 *   · the inventory has no talk row; a template is never opened
 *   · a roster with no `mintFor:` binds as today
 *   · one template whose seats come from two teams wakes both, and a dotless
 *     org seat id is a seat id
 *   · an org default and a team `mintFor:` for the same collection are refused
 *     together, with every other refusal of the boot
 */
import { afterEach, describe, expect, it } from "vitest";
import { defineFlow, defineResourceCollection, dispatcher, handler, sequencer } from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import type { StoreRegistry } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  CHANNEL_KIND,
  channelInstances,
  channelNotifyInputSchema,
  defineChannelFlow,
  defineProjectsCollection,
  hireWorkforce,
  openChannels,
  openInventory,
  wakeMemberSeats,
  workerConfigSchema,
  type ChannelManifest,
  type ChannelNotifyInput,
  type ProjectRow,
  type WorkerManifest
} from "../src/index";
import { CHANNEL_ANSWER_ACTION } from "../src/channel/channel-flow";
import { forgetOrgTalkTemplate, forgetTalkReaction } from "../src/projects/talk-template";

const ORG = "lab";
const projects = defineProjectsCollection();

// Each test declares the org template it needs, as a fresh process would;
// neither the template nor the reaction leaks into the next.
afterEach(() => {
  forgetOrgTalkTemplate(projects);
  forgetTalkReaction(projects);
});

/** A team's channel record. */
const channel = (id: string, declared: Record<string, unknown> = {}, body = ""): ChannelManifest => ({
  id,
  declared: { description: `The ${id} channel.`, ...declared },
  body
});

/** Whatever `channelInstances` refused, as one message. */
function refusalOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected channelInstances to refuse");
}

describe("declaring a talk template", () => {
  it("refuses a template with a board, an unknown or wrong collection, a bad seat id, and two templates for one collection, all at once", () => {
    defineProjectsCollection({ talk: { seats: ["eng.em"], charter: "Org charter." } });
    const other = defineResourceCollection({ pattern: "notes/*", scope: "org", stateSchema: z.object({}) });
    const message = refusalOf(() =>
      channelInstances(
        [
          channel("eng.feature", { members: ["eng.em"] }),
          channel("eng.room", { mintFor: "projects", members: ["eng.em"] }, "Team charter."),
          channel("ops.boarded", { mintFor: "projects", boards: ["work"] }),
          channel("ops.nowhere", { mintFor: "tickets" }),
          channel("ops.notes", { mintFor: "notes" }),
          channel("ops.badseat", { mintFor: "projects", members: ["a.b.c"] }),
          channel("eng.typo", { member: ["eng.em"] })
        ],
        { resources: { projects, notes: other } }
      )
    );
    // Every refusal of the boot, named, in one message.
    expect(message).toContain("refused 6 of 8 declarations");
    expect(message).toMatch(/channel "ops\.boarded" — .*`mintFor:` and `boards:`/);
    expect(message).toMatch(/channel "ops\.nowhere" — names collection "tickets", which is not in the org's resources/);
    expect(message).toMatch(/channel "ops\.notes" — names "notes", which is not the projects collection/);
    expect(message).toMatch(/channel "ops\.badseat" — .*seat "a\.b\.c" is not a seat id/);
    expect(message).toMatch(/channel "eng\.typo" — declares `member`/);
    // The org default and the team template for one collection are refused together, in one line naming both.
    expect(message).toMatch(
      /the "projects" collection has 2 talk templates: the talk template beside "projects" in the org's resources on kind "channel"; channel "eng\.room" on kind "channel"/
    );
    expect(message).not.toContain('channel "eng.feature"');
  });

  it("takes a full seat id from any team and a dotless org seat id, and refuses anything else in the org default", () => {
    defineProjectsCollection({ talk: { seats: ["eng.em", "ops.lead", "chief-of-staff"] } });
    expect(() => channelInstances([], { resources: { projects } })).not.toThrow();

    // A bad org seat fails where the template is declared, before any bind.
    expect(() => defineProjectsCollection({ talk: { seats: ["Chief Of Staff"] } })).toThrow(
      /the talk template's seat "Chief Of Staff" is not a seat id/
    );
    expect(() => defineProjectsCollection({ talk: { seats: ["a.b.c"] } })).toThrow(/seat "a\.b\.c" is not a seat id/);
  });

  it("refuses a template on a kind defineChannelFlow did not build", () => {
    defineProjectsCollection({ talk: { seats: ["eng.em"], kind: "custom" } });
    const custom = Object.assign(() => defineFlow({ kind: "custom", cardinality: "singleton", actions: {} })(), {
      kind: "custom"
    });
    expect(refusalOf(() => channelInstances([], { kinds: { custom } as never, resources: { projects } }))).toMatch(
      /runs talk sessions on kind "custom", which is not a kind `defineChannelFlow` built/
    );
  });

  it("registers the template's kind with no channel on it, holding the template, and installs the mint on create", () => {
    defineProjectsCollection({ talk: { seats: ["eng.em"], charter: "Org charter." } });
    const instances = channelInstances([], { resources: { projects } });
    expect(instances.map((instance) => instance.kind)).toEqual([CHANNEL_KIND]);
    expect((projects as { reactTo?: { created?: unknown } }).reactTo?.created).toBeDefined();
  });

  it("binds a roster with no template as today: no reaction, and a template file is never opened or registered", async () => {
    const plain = channelInstances([channel("eng.feature", { members: ["eng.em"] })], { resources: { projects } });
    expect((projects as { reactTo?: unknown }).reactTo).toBeUndefined();
    expect(Object.keys((plain[0] as unknown as { actions: object }).actions)).toEqual(["post", "read", "join"]);

    const records = [channel("eng.feature", { members: ["eng.em"] }), channel("eng.room", { mintFor: "projects" })];
    const opened: string[] = [];
    await openChannels(records, {
      userId: "alice",
      client: {
        createSession: async (options) => {
          opened.push(options.sessionId ?? "");
        },
        getSession: async () => {
          throw new Error("not reached");
        },
        deleteSession: async () => undefined
      }
    });
    expect(opened).toEqual(["eng.feature"]);

    const registered: string[] = [];
    const binding = await openInventory(
      { seats: [], channels: records },
      {
        userId: "alice",
        orgId: ORG,
        run: async (request) => {
          registered.push(request.sessionId);
        }
      }
    );
    expect(registered).toEqual(["eng.feature"]);
    expect(binding).toMatchObject({ channels: 1, problems: [] });
  });
});

describe("a host that builds several flows", () => {
  it("keeps the mint a template installed when a later channelInstances call carries no template", () => {
    defineProjectsCollection({ talk: { seats: ["eng.em"] } });
    channelInstances([channel("eng.feature", { members: ["eng.em"] })], { resources: { projects } });
    const installed = (projects as { reactTo?: unknown }).reactTo;
    expect(installed).toBeDefined();

    // A second flow's channels, bound with no resources and no template.
    channelInstances([channel("ops.release", { members: ["ops.lead"] })]);
    expect((projects as { reactTo?: unknown }).reactTo).toBe(installed);
  });

  it("refuses a second call that would mint project talk sessions on another kind", () => {
    defineProjectsCollection({ talk: { seats: ["eng.em"] } });
    channelInstances([], { resources: { projects } });
    defineProjectsCollection({ talk: { seats: ["eng.em"], kind: "talk" } });
    const talk = defineChannelFlow();
    Object.assign(talk, { kind: "talk" });
    expect(() => channelInstances([], { kinds: { talk } as never, resources: { projects } })).toThrow(
      /already mint on kind "channel" in this process, and a template now names kind "talk"/
    );
  });
});

// --- The runtime half ---

/** One run of a listening seat: which seat, whose session, which conversation, and what it was handed. */
type Heard = { seat: string; owner: string | undefined; conversation: string; post: ChannelNotifyInput };

/**
 * A seat kind that records each post it hears, then answers into the room the
 * way the built-in agent kind lands a routed reply: one dispatch into the
 * post's session's `answer`, as itself.
 */
function listeningKind(heard: Heard[]) {
  const record = handler({
    name: "test-record-heard",
    inputSchema: channelNotifyInputSchema,
    outputSchema: channelNotifyInputSchema,
    execute: (post: ChannelNotifyInput, ctx) => {
      heard.push({
        seat: (ctx.flow.config as { seatId: string }).seatId,
        owner: ctx.session.identity.userId,
        conversation: ctx.session.identity.id,
        post
      });
      return post;
    }
  });
  const answer = dispatcher({
    name: "test-answer-in-room",
    flowKind: CHANNEL_KIND,
    action: CHANNEL_ANSWER_ACTION,
    inputSchema: channelNotifyInputSchema,
    session: { id: (post: ChannelNotifyInput) => post.channelId },
    payload: (post: ChannelNotifyInput) => ({ postId: post.postId, body: `noted: ${post.body}`, author: post.member })
  });
  return defineFlow({
    kind: "listener",
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    actions: {},
    internal: {
      actions: {
        onChannelPost: {
          inputSchema: channelNotifyInputSchema,
          block: sequencer({ name: "test-heard", inputSchema: channelNotifyInputSchema })
            .step(record)
            .tapIf((post: ChannelNotifyInput) => post.body.startsWith("[answer]"), answer)
        }
      }
    }
  } as never);
}

const seatRecord = (id: string): WorkerManifest => ({ id, declared: { flow: "listener" }, body: "" });

/** The app's own flow: creates a row directly, inside a turn, and reads one back. */
const writeRow = handler({
  name: "write-row",
  inputSchema: z.object({ id: z.string(), members: z.array(z.string()) }),
  outputSchema: z.object({}),
  resources: { projects },
  execute: async (input, ctx) => {
    const rows = ctx.resources.projects as unknown as ResourceCollectionRef<ProjectRow>;
    await rows.create(input.id, {
      id: input.id,
      title: input.id,
      brief: null,
      status: "active",
      ownerUserId: ctx.session.identity.userId ?? "",
      members: input.members,
      workstreams: [],
      sessions: []
    });
    return {};
  }
});
const readRow = handler({
  name: "read-row",
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ row: z.unknown() }),
  resources: { projects },
  execute: async (input, ctx) => {
    const rows = ctx.resources.projects as unknown as ResourceCollectionRef<ProjectRow>;
    const row = await rows.getOptional(input.id);
    return { row: row === undefined ? null : { ...row.state } };
  }
});
const appFlow = defineFlow({ kind: "app", actions: { writeRow: { block: writeRow }, readRow: { block: readRow } } });

type Answer = { status: number; json: any };

/**
 * Boot a host over `stores`: the template's seats hired on the listening kind,
 * the channel kind built waking them, and `channelInstances` reading the org
 * template (when `talk` is given) from the resources.
 */
async function boot(options: { talk?: { seats: string[]; charter?: string }; stores?: StoreRegistry; seats?: string[] }) {
  const heard: Heard[] = [];
  const seats = hireWorkforce((options.seats ?? ["eng.em", "ops.lead", "chief-of-staff"]).map(seatRecord), {
    kinds: { listener: listeningKind(heard) as never }
  });
  // No template stands for a fresh process: nothing declared, nothing installed.
  if (options.talk === undefined) {
    forgetOrgTalkTemplate(projects);
    forgetTalkReaction(projects);
  } else defineProjectsCollection({ talk: options.talk });
  const [kind] = channelInstances([], {
    kinds: { [CHANNEL_KIND]: defineChannelFlow({ notify: wakeMemberSeats(seats) }) as never },
    resources: { projects }
  });
  // A roster with no template registers no channel kind at all; projects still talk on the built-in.
  const talkKind = kind ?? defineChannelFlow({ notify: wakeMemberSeats(seats) })();
  const stores = options.stores ?? inMemoryStores();
  const state = createFlowState({
    flows: { app: appFlow(), [CHANNEL_KIND]: talkKind, ...Object.fromEntries(seats.map((seat) => [seat.id, seat])) },
    stores: { default: { primary: stores } },
    modelResolver: createMockModelResolver({}),
    resolvePrincipal: (context: any) => {
      const user = context.request?.headers.get("x-verified-user");
      return user == null ? null : { userId: user, orgId: ORG };
    }
  } as never);
  const router = (await state.getRouter()) as any;
  const runtimeStores: StoreRegistry = (await state.getRuntime()).stores;

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
  /** Run an action, wait for it to settle, and return its output; throws unless it completed. */
  const ok = async (user: string, flow: string, sessionId: string, action: string, input: unknown): Promise<any> => {
    const answer = await call("POST", user, [flow, sessionId, "actions", action], { userId: user, input });
    const requestId = answer.json?.request?.id;
    if (requestId === undefined) throw new Error(`${action}: ${answer.status} ${JSON.stringify(answer.json)}`);
    for (let i = 0; i < 1000; i += 1) {
      const polled = await call("GET", user, [flow, "requests", requestId, "status"]);
      if (["completed", "errored", "failed", "cancelled"].includes(polled.json?.status)) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    const { json } = await call("GET", user, ["sessions", sessionId, "requests"], undefined, "?include_result_output=true");
    const found = ((json?.requests ?? []) as Array<Record<string, any>>).find((r) => r.id === requestId) ?? {};
    if (found.status !== "completed") throw new Error(`${action} as ${user}: ${found.status} ${JSON.stringify(found.result?.error)}`);
    return found.result?.output;
  };
  const app = await openSession("alice", "app");
  const rowOf = async (id: string): Promise<ProjectRow | null> => (await ok("alice", "app", app, "readRow", { id })).row;
  const until = async <T>(read: () => Promise<T | undefined>, label: string): Promise<T> => {
    for (let i = 0; i < 400; i += 1) {
      const value = await read();
      if (value !== undefined) return value;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`timed out waiting for ${label}`);
  };
  const sessionOf = (id: string, user: string) =>
    until(async () => (await rowOf(id))?.sessions.find((link) => link.userId === user)?.sessionId, `${user}'s talk session on ${id}`);
  return { heard, call, openSession, ok, app, rowOf, until, sessionOf, stores: runtimeStores };
}

describe("a project's talk template at runtime", () => {
  it("mints the creator's talk session in the creating turn, linked both ways; with no template, nothing mints", async () => {
    const h = await boot({ talk: { seats: ["eng.em"], charter: "Plan the work." } });
    await h.ok("alice", "app", h.app, "writeRow", { id: "apollo", members: ["alice", "bob"] });
    const talk = await h.sessionOf("apollo", "alice");
    // Both sides agree: the session names the row, and the row lists the session.
    // It is a child of the session whose turn created the row, keyed on the row.
    const record = (await h.call("GET", "alice", ["sessions", talk])).json.session;
    expect(record).toMatchObject({ state: { resourceId: "apollo" }, userId: "alice", parentSessionId: h.app, topic: "talk:apollo" });
    expect((await h.rowOf("apollo"))!.sessions).toEqual([{ sessionId: talk, userId: "alice" }]);

    // The negative control: the same write with no template mints nothing.
    const bare = await boot({});
    await bare.ok("alice", "app", bare.app, "writeRow", { id: "hermes", members: ["alice"] });
    await new Promise((r) => setTimeout(r, 100));
    expect((await bare.rowOf("hermes"))!.sessions).toEqual([]);
  });

  it("mints nothing for a row written outside a turn", async () => {
    const h = await boot({ talk: { seats: ["eng.em"] } });
    await h.stores.resourceState.set(
      "org",
      ORG,
      "projects/zeus",
      { id: "zeus", title: "Zeus", ownerUserId: "alice", members: ["alice"], workstreams: [], sessions: [] },
      "absent"
    );
    await new Promise((r) => setTimeout(r, 100));
    // The row reads back, so the write landed where a flow reads; no session was minted for it.
    expect(await h.rowOf("zeus")).toMatchObject({ id: "zeus", sessions: [] });
  });

  it("wakes each template seat once per post, from two teams and the org, under the poster, keyed per room, with the room's recent lines; an answer lands in the room for everyone", async () => {
    const h = await boot({ talk: { seats: ["eng.em", "ops.lead", "chief-of-staff"], charter: "Plan the work." } });
    await h.ok("alice", "app", h.app, "writeRow", { id: "apollo", members: ["alice", "bob"] });
    const aliceTalk = await h.sessionOf("apollo", "alice");
    const bobTalk = (await h.ok("bob", CHANNEL_KIND, await h.openSession("bob", CHANNEL_KIND), "join", { projectId: "apollo" }))
      .sessionId as string;

    await h.ok("alice", CHANNEL_KIND, aliceTalk, "post", { body: "first" });
    await h.until(async () => (h.heard.length === 3 ? true : undefined), "three wakes for alice's first post");
    await h.ok("alice", CHANNEL_KIND, aliceTalk, "post", { body: "[answer] second" });
    await h.ok("bob", CHANNEL_KIND, bobTalk, "post", { body: "third" });
    await h.until(async () => (h.heard.length === 9 ? true : undefined), "nine wakes");
    await new Promise((r) => setTimeout(r, 100));
    expect(h.heard).toHaveLength(9);

    // Once per seat per post, every seat from either team and the org.
    for (const body of ["first", "[answer] second", "third"]) {
      expect(h.heard.filter((run) => run.post.body === body).map((run) => run.seat).sort()).toEqual([
        "chief-of-staff",
        "eng.em",
        "ops.lead"
      ]);
    }
    // Under the poster, and one seat conversation per person per room.
    for (const run of h.heard) {
      expect(run.owner).toBe(run.post.body === "third" ? "bob" : "alice");
      expect(run.post.channelId).toBe(run.post.body === "third" ? bobTalk : aliceTalk);
      expect(run.post.routed).toBe(true);
    }
    const conversations = (seat: string, user: string) =>
      new Set(h.heard.filter((run) => run.seat === seat && run.owner === user).map((run) => run.conversation));
    expect(conversations("eng.em", "alice").size).toBe(1);
    expect(conversations("eng.em", "bob").size).toBe(1);
    expect([...conversations("eng.em", "alice")][0]).not.toBe([...conversations("eng.em", "bob")][0]);

    // The room's recent lines ride along, oldest first: none before the first post.
    const firstHeard = h.heard.find((run) => run.post.body === "first")!;
    expect(firstHeard.post.recent).toEqual([]);
    const thirdHeard = h.heard.find((run) => run.post.body === "third")!;
    expect(thirdHeard.post.recent!.map((line) => line.body)).toEqual(
      expect.arrayContaining(["first", "[answer] second"])
    );
    expect(thirdHeard.post.recent![0]).toMatchObject({ body: "first", principal: "alice" });

    // Each seat's answer to alice's second post is in the room, for bob too, as the seat.
    const read = await h.until(async () => {
      const page = await h.ok("bob", CHANNEL_KIND, bobTalk, "read", { after: 0 });
      return page.lines.filter((line: { author: string | null }) => line.author !== null).length === 3 ? page : undefined;
    }, "three seat answers in the room");
    expect(read.charter).toBe("Plan the work.");
    expect(read.seats).toEqual(["eng.em", "ops.lead", "chief-of-staff"]);
    const answers = read.lines.filter((line: { author: string | null }) => line.author !== null);
    expect(answers.map((line: { author: string }) => line.author).sort()).toEqual(["chief-of-staff", "eng.em", "ops.lead"]);
    for (const line of answers) expect(line).toMatchObject({ userId: "alice", body: "noted: [answer] second" });
    // An answer wakes nobody: still three wakes per person's post.
    expect(h.heard).toHaveLength(9);
  });

  it("reaches an existing talk session with an edited template at the next boot", async () => {
    const stores = inMemoryStores();
    const before = await boot({ stores, talk: { seats: ["eng.em"], charter: "Old charter." } });
    await before.ok("alice", "app", before.app, "writeRow", { id: "apollo", members: ["alice"] });
    const talk = await before.sessionOf("apollo", "alice");
    await before.ok("alice", CHANNEL_KIND, talk, "post", { body: "before the edit" });
    await before.until(async () => (before.heard.length === 1 ? true : undefined), "one wake before the edit");

    // The same store, restarted with a seat added and the charter rewritten.
    const after = await boot({ stores, talk: { seats: ["eng.em", "ops.lead"], charter: "New charter." } });
    await after.ok("alice", CHANNEL_KIND, talk, "post", { body: "after the edit" });
    await after.until(async () => (after.heard.length === 2 ? true : undefined), "two wakes after the edit");
    expect(after.heard.map((run) => run.seat).sort()).toEqual(["eng.em", "ops.lead"]);
    const page = await after.ok("alice", CHANNEL_KIND, talk, "read", { after: 0 });
    expect(page).toMatchObject({ charter: "New charter.", seats: ["eng.em", "ops.lead"] });
    expect(page.lines.map((line: { body: string }) => line.body)).toEqual(["before the edit", "after the edit"]);
  });
});
