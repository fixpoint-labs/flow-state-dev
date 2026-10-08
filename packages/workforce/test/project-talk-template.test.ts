/**
 * A project's talk template, and the wakes a post in a project's room makes.
 *
 * The binder half reads templates from both sites (the org-level default
 * beside the projects collection, and a team `MAILBOX.md` marked `mintFor:`),
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
import { defineFlow, defineResourceCollection, dispatcher, handler, router as routerBlock, sequencer } from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { StoreRegistry } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  MAILBOX_KIND,
  mailboxInstances,
  mailboxNotifyInputSchema,
  defineMailboxFlow,
  defineProjectBlocks,
  defineProjectsCollection,
  openMailboxes,
  openInventory,
  wakeMemberSeats,
  workerConfigSchema,
  type MailboxManifest,
  type MailboxNotifyInput,
  type ProjectRow,
  type WorkerManifest,
} from "../src/index";
import { mintSeats } from "../src/hire";
import { MAILBOX_ANSWER_ACTION } from "../src/mailbox/mailbox-flow";
import { forgetOrgTalkTemplate, forgetTalkTemplate, registeredTalkTemplate } from "../src/projects/talk-template";
import { roomLineKey } from "../src/projects/collections";
import { workerDoor } from "./worker-door";

const ORG = "lab";
const projects = defineProjectsCollection();

// Each test declares the org template it needs, as a fresh process would;
// neither the template, its registration nor the reaction leaks into the next.
afterEach(() => {
  forgetOrgTalkTemplate(projects);
  forgetTalkTemplate(projects);
});

/** A team's mailbox record. */
const mailbox = (id: string, declared: Record<string, unknown> = {}, body = ""): MailboxManifest => ({
  id,
  declared: { description: `The ${id} mailbox.`, ...declared },
  body
});

/** Whatever `mailboxInstances` refused, as one message. */
function refusalOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected mailboxInstances to refuse");
}

/** The built-in kind built waking seats, as a host with a talk template passes it. */
const waking = () => ({ [MAILBOX_KIND]: defineMailboxFlow({ notify: wakeMemberSeats([]) }) }) as never;

describe("declaring a talk template", () => {
  it("refuses a template with a board, an unknown or wrong collection, a bad seat id, and two templates for one collection, all at once", () => {
    defineProjectsCollection({ talk: { seats: ["eng.em"], charter: "Org charter." } });
    const other = defineResourceCollection({ pattern: "notes/*", scope: "org", stateSchema: z.object({}) });
    const message = refusalOf(() =>
      mailboxInstances(
        [
          mailbox("eng.feature", { members: ["eng.em"] }),
          mailbox("eng.room", { mintFor: "projects", members: ["eng.em"] }, "Team charter."),
          mailbox("ops.boarded", { mintFor: "projects", boards: ["work"] }),
          mailbox("ops.nowhere", { mintFor: "tickets" }),
          mailbox("ops.notes", { mintFor: "notes" }),
          mailbox("ops.badseat", { mintFor: "projects", members: ["a.b.c"] }),
          mailbox("ops.flowed", { mintFor: "projects", flow: "mailbox" }),
          mailbox("eng.typo", { member: ["eng.em"] })
        ],
        { kinds: waking(), resources: { projects, notes: other } }
      )
    );
    // Every refusal of the boot, named, in one message.
    expect(message).toContain("refused 7 of 9 declarations");
    expect(message).toMatch(/mailbox "ops\.boarded" — .*`mintFor:` and `boards:`/);
    expect(message).toMatch(/mailbox "ops\.nowhere" — names collection "tickets", which is not in the org's resources/);
    expect(message).toMatch(/mailbox "ops\.notes" — names "notes", which is not the projects collection/);
    expect(message).toMatch(/mailbox "ops\.badseat" — .*seat "a\.b\.c" is not a seat id/);
    expect(message).toMatch(/mailbox "eng\.typo" — declares `member`/);
    // A template runs on the built-in kind; there is no kind to choose.
    expect(message).toMatch(/mailbox "ops\.flowed" — .*`mintFor:` and `flow:`.*runs on the built-in mailbox kind/);
    // The org default and the team template for one collection are refused together, in one line naming both.
    expect(message).toMatch(
      /the "projects" collection has 2 talk templates: the talk template beside "projects" in the org's resources; mailbox "eng\.room"\./
    );
    expect(message).not.toContain('mailbox "eng.feature"');
  });

  it("keeps the first org template: the same one declared again is a no-op, a different one throws where it is declared", () => {
    defineProjectsCollection({ talk: { seats: ["eng.em"], charter: "Plan." } });
    // Any module may declare the collection; the same template again changes nothing.
    expect(() => defineProjectsCollection({ talk: { seats: ["eng.em"], charter: "Plan." } })).not.toThrow();
    expect(() => defineProjectsCollection()).not.toThrow();
    // A different one is refused, and the first still stands.
    expect(() => defineProjectsCollection({ talk: { seats: ["ops.lead"], charter: "Plan." } })).toThrow(
      /a talk template is already declared beside this collection \(seats \["eng\.em"\]\).*\["ops\.lead"\]/
    );
    expect(() => defineProjectsCollection({ talk: { seats: ["eng.em"], charter: "Other." } })).toThrow(
      /already declared beside this collection/
    );
    mailboxInstances([], { kinds: waking(), resources: { projects } });
    expect(registeredTalkTemplate(projects)?.facts).toEqual({ seats: ["eng.em"], charter: "Plan." });
  });

  it("takes a full seat id from any team and a dotless org seat id, and refuses anything else in the org default", () => {
    defineProjectsCollection({ talk: { seats: ["eng.em", "ops.lead", "chief-of-staff"] } });
    expect(() => mailboxInstances([], { kinds: waking(), resources: { projects } })).not.toThrow();

    // A bad org seat fails where the template is declared, before any bind.
    expect(() => defineProjectsCollection({ talk: { seats: ["Chief Of Staff"] } })).toThrow(
      /the talk template's seat "Chief Of Staff" is not a seat id/
    );
    expect(() => defineProjectsCollection({ talk: { seats: ["a.b.c"] } })).toThrow(/seat "a\.b\.c" is not a seat id/);
  });

  it("refuses a talk kind defineMailboxFlow did not build, or one filed under the built-in's key", () => {
    defineProjectsCollection({ talk: { seats: ["eng.em"] } });
    const custom = Object.assign(() => defineFlow({ kind: MAILBOX_KIND, cardinality: "singleton", actions: {} })(), {
      kind: MAILBOX_KIND
    });
    expect(refusalOf(() => mailboxInstances([], { kinds: { [MAILBOX_KIND]: custom } as never, resources: { projects } }))).toMatch(
      /the talk template beside "projects" in the org's resources — .*not one `defineMailboxFlow` built/
    );
    // A kind of another name under the built-in's key would run a different graph.
    const other = Object.assign(defineMailboxFlow({ notify: wakeMemberSeats([]) }), { kind: "other" });
    expect(refusalOf(() => mailboxInstances([], { kinds: { [MAILBOX_KIND]: other } as never, resources: { projects } }))).toMatch(
      /the flow passed under that key is kind "other"/
    );
  });

  it("refuses a seat listed twice at both declaration sites, so one post never wakes a seat twice", () => {
    expect(() => defineProjectsCollection({ talk: { seats: ["eng.em", "ops.lead", "eng.em"] } })).toThrow(
      /seat "eng\.em" is listed twice/
    );
    expect(
      refusalOf(() =>
        mailboxInstances([mailbox("eng.room", { mintFor: "projects", members: ["eng.em", "eng.em"] })], {
          resources: { projects }
        })
      )
    ).toMatch(/mailbox "eng\.room" — .*seat "eng\.em" is listed twice/);
  });

  it("refuses a template with seats on a kind built with no notify block, which would wake none of them", () => {
    defineProjectsCollection({ talk: { seats: ["eng.em"] } });
    // The default: `mailboxInstances` seeds the built-in kind, which wakes nobody.
    expect(refusalOf(() => mailboxInstances([], { resources: { projects } }))).toMatch(
      /names seats, but talk sessions run on kind "mailbox", which was built with no `notify` block/
    );
    // A template with no seats wakes nobody by design, so the plain kind serves it (a fresh process).
    forgetOrgTalkTemplate(projects);
    defineProjectsCollection({ talk: { seats: [], charter: "Just the room." } });
    expect(() => mailboxInstances([], { resources: { projects } })).not.toThrow();
  });

  it("registers the template's kind with no mailbox on it, holding the template, and installs the mint on create", () => {
    defineProjectsCollection({ talk: { seats: ["eng.em"], charter: "Org charter." } });
    const instances = mailboxInstances([], { kinds: waking(), resources: { projects } });
    expect(instances.map((instance) => instance.kind)).toEqual([MAILBOX_KIND]);
    expect((projects as { reactTo?: { created?: unknown } }).reactTo?.created).toBeDefined();
  });

  it("reads one projects collection exposed under two refs as one template, not two rivals", () => {
    defineProjectsCollection({ talk: { seats: ["eng.em"], charter: "Plan." } });
    const instances = mailboxInstances([], { kinds: waking(), resources: { projects, workProjects: projects } });
    expect(instances.map((instance) => instance.kind)).toEqual([MAILBOX_KIND]);
    expect(registeredTalkTemplate(projects)?.facts).toEqual({ seats: ["eng.em"], charter: "Plan." });
  });

  it("accepts later calls that reach the same template through another alias or order, and still refuses a different one", () => {
    defineProjectsCollection({ talk: { seats: ["eng.em"], charter: "Plan." } });
    mailboxInstances([], { kinds: waking(), resources: { projects } });
    // The same collection and facts, under another ref, and under two refs in the other order.
    expect(() => mailboxInstances([], { kinds: waking(), resources: { workProjects: projects } })).not.toThrow();
    expect(() => mailboxInstances([], { kinds: waking(), resources: { b: projects, a: projects } })).not.toThrow();
    expect(() => mailboxInstances([], { kinds: waking(), resources: { a: projects, b: projects } })).not.toThrow();
    expect(registeredTalkTemplate(projects)?.facts).toEqual({ seats: ["eng.em"], charter: "Plan." });

    // Other facts under any alias are a second template.
    forgetOrgTalkTemplate(projects);
    defineProjectsCollection({ talk: { seats: ["ops.lead"], charter: "Plan." } });
    expect(() => mailboxInstances([], { kinds: waking(), resources: { workProjects: projects } })).toThrow(
      /already have a talk template in this process .*with other seats or charter/
    );
  });

  it("binds a roster with no template as today: no reaction, and a template file is never opened or registered", async () => {
    const plain = mailboxInstances([mailbox("eng.feature", { members: ["eng.em"] })], { resources: { projects } });
    expect((projects as { reactTo?: unknown }).reactTo).toBeUndefined();
    expect(Object.keys((plain[0] as unknown as { actions: object }).actions)).toEqual(["post", "read", "join"]);

    const records = [mailbox("eng.feature", { members: ["eng.em"] }), mailbox("eng.room", { mintFor: "projects" })];
    const opened: string[] = [];
    await openMailboxes(records, {
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
      { seats: [], mailboxes: records },
      {
        userId: "alice",
        orgId: ORG,
        seatWriter: { flowKind: MAILBOX_KIND },
        run: async (request) => {
          registered.push(`${request.action} ${request.sessionId} ${JSON.stringify(request.input)}`);
        }
      }
    );
    // The template registers nothing; its id only goes to the writer, to retire any old mailbox row.
    expect(registered).toEqual([
      'retireMailboxesInInventory inventory-binder {"ids":["eng.room"]}',
      "registerMailboxInInventory eng.feature {}"
    ]);
    expect(binding).toMatchObject({ mailboxes: 1, problems: [] });

    // With no writer named, the retirement is named as a problem rather than skipped.
    const unwritten = await openInventory({ seats: [], mailboxes: records }, { userId: "alice", orgId: ORG, run: async () => undefined });
    expect(unwritten.problems).toEqual([expect.stringMatching(/talk templates "eng\.room" could not be retired .*no `seatWriter`/)]);
  });
});

describe("a host that builds several flows", () => {
  it("builds every later call's mailbox kind from the one registered template, with or without resources", () => {
    defineProjectsCollection({ talk: { seats: ["eng.em"] } });
    mailboxInstances([mailbox("eng.feature", { members: ["eng.em"] })], { kinds: waking(), resources: { projects } });
    const installed = (projects as { reactTo?: unknown }).reactTo;
    expect(installed).toBeDefined();

    // A second flow's mailboxes, bound with no resources: the reaction stands,
    // and its mailbox kind is built holding the template (`onTalkPosted`).
    const later = mailboxInstances([mailbox("ops.release", { members: ["ops.lead"] })], { kinds: waking() });
    expect((projects as { reactTo?: unknown }).reactTo).toBe(installed);
    expect(later.map((instance) => instance.kind)).toEqual([MAILBOX_KIND]);
    expect(Object.keys((later[0] as unknown as { internal?: { actions?: object } }).internal?.actions ?? {})).toContain("onTalkPosted");

    // A later call whose mailbox kind could not wake the registered seats is refused, naming the template.
    expect(refusalOf(() => mailboxInstances([mailbox("ops.release", { members: ["ops.lead"] })]))).toMatch(
      /the talk template registered in this process \(the talk template beside "projects" in the org's resources\) — names seats/
    );
  });

  it("reports a later call's different template together with its other refusals, in one throw", () => {
    defineProjectsCollection({ talk: { seats: ["eng.em"], charter: "Plan." } });
    mailboxInstances([], { kinds: waking(), resources: { projects } });

    // Another flow's roster: a team template that differs from the registered one, and a malformed mailbox.
    forgetOrgTalkTemplate(projects);
    const message = refusalOf(() =>
      mailboxInstances(
        [
          mailbox("eng.room", { mintFor: "projects", members: ["ops.lead"] }, "Plan."),
          mailbox("eng.typo", { member: ["eng.em"] })
        ],
        { kinds: waking(), resources: { projects } }
      )
    );
    expect(message).toContain("refused 2 of 2 mailboxes");
    expect(message).toMatch(/mailbox "eng\.room" — project rooms already have a talk template in this process/);
    expect(message).toMatch(/mailbox "eng\.typo" — declares `member`/);
    // Nothing was registered over the first template.
    expect(registeredTalkTemplate(projects)?.facts).toEqual({ seats: ["eng.em"], charter: "Plan." });
  });

  it("registers one template per process: the same one again is a no-op, a different one is refused", () => {
    defineProjectsCollection({ talk: { seats: ["eng.em"], charter: "Plan." } });
    mailboxInstances([], { kinds: waking(), resources: { projects } });
    // The same roster bound again, as a host binding it once per flow does.
    expect(() => mailboxInstances([], { kinds: waking(), resources: { projects } })).not.toThrow();

    // The same facts from another site are the same template; other seats, at any site, are a second one.
    forgetOrgTalkTemplate(projects);
    expect(() =>
      mailboxInstances([mailbox("eng.room", { mintFor: "projects", members: ["eng.em"] }, "Plan.")], {
        kinds: waking(),
        resources: { projects }
      })
    ).not.toThrow();
    expect(() =>
      mailboxInstances([mailbox("eng.room", { mintFor: "projects", members: ["ops.lead"] }, "Plan.")], {
        kinds: waking(),
        resources: { projects }
      })
    ).toThrow(/already have a talk template in this process .*mailbox "eng\.room" would be a second with other seats or charter\./);
    defineProjectsCollection({ talk: { seats: ["ops.lead"], charter: "Plan." } });
    expect(() => mailboxInstances([], { kinds: waking(), resources: { projects } })).toThrow(
      /already have a talk template in this process \(the talk template beside "projects" in the org's resources\).*with other seats or charter/
    );
  });
});

// --- The runtime half ---

/** One run of a listening seat: which seat, whose session, which conversation, and what it was handed. */
type Heard = { seat: string; owner: string | undefined; conversation: string; post: MailboxNotifyInput };

/**
 * A seat kind that records each post it hears, then answers into the room the
 * way the built-in agent kind lands a routed reply: one dispatch into the
 * post's session's `answer`, as itself.
 */
function listeningKind(heard: Heard[], kept: { postId?: string; token?: string }) {
  const record = handler({
    name: "test-record-heard",
    inputSchema: mailboxNotifyInputSchema,
    outputSchema: mailboxNotifyInputSchema,
    execute: (post: MailboxNotifyInput, ctx) => {
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
    flowKind: MAILBOX_KIND,
    action: MAILBOX_ANSWER_ACTION,
    inputSchema: mailboxNotifyInputSchema,
    session: { id: (post: MailboxNotifyInput) => post.mailboxId },
    payload: (post: MailboxNotifyInput) => ({
      postId: post.postId,
      body: `noted: ${post.body}`,
      author: post.member,
      token: post.answerToken
    })
  });
  // A seat answering as another template seat, with its own delivery's token.
  const impersonate = dispatcher({
    name: "test-answer-as-another-seat",
    flowKind: MAILBOX_KIND,
    action: MAILBOX_ANSWER_ACTION,
    inputSchema: mailboxNotifyInputSchema,
    session: { id: (post: MailboxNotifyInput) => post.mailboxId },
    payload: (post: MailboxNotifyInput) => ({
      postId: post.postId,
      body: `forged by ${post.member}`,
      author: "ops.lead",
      token: post.answerToken
    })
  });
  // A seat keeping one delivery's token, then answering that post with it from
  // a later run woken under another member, through that member's session.
  const keep = handler({
    name: "test-keep-token",
    inputSchema: mailboxNotifyInputSchema,
    outputSchema: mailboxNotifyInputSchema,
    execute: (post: MailboxNotifyInput) => {
      kept.postId = post.postId;
      kept.token = post.answerToken;
      return post;
    }
  });
  const replay = dispatcher({
    name: "test-answer-with-a-kept-token",
    flowKind: MAILBOX_KIND,
    action: MAILBOX_ANSWER_ACTION,
    inputSchema: mailboxNotifyInputSchema,
    session: { id: (post: MailboxNotifyInput) => post.mailboxId },
    payload: (post: MailboxNotifyInput) => ({
      postId: kept.postId as string,
      body: `replayed by ${post.member}`,
      author: post.member,
      token: kept.token
    })
  });
  // Holds the genuine answer back, so a forged one would land first.
  const later = handler({
    name: "test-answer-later",
    inputSchema: mailboxNotifyInputSchema,
    outputSchema: mailboxNotifyInputSchema,
    execute: async (post: MailboxNotifyInput) => {
      await new Promise((r) => setTimeout(r, 300));
      return post;
    }
  });
  const impersonating = (post: MailboxNotifyInput) => post.body.startsWith("[impersonate]");
  const holding = (post: MailboxNotifyInput) => post.body.startsWith("[hold]");
  const replaying = (post: MailboxNotifyInput) => post.body.startsWith("[replay]");
  return defineFlow({
    kind: "listener",
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    actions: { ...workerDoor,},
    internal: {
      actions: {
        onMailboxPost: {
          inputSchema: mailboxNotifyInputSchema,
          block: sequencer({ name: "test-heard", inputSchema: mailboxNotifyInputSchema })
            .step(record)
            .tapIf((post: MailboxNotifyInput) => post.body.startsWith("[answer]"), answer)
            // The same delivery answered twice, as a replayed or retried delivery would.
            .tapIf((post: MailboxNotifyInput) => post.body.startsWith("[answer-twice]"), answer)
            .tapIf((post: MailboxNotifyInput) => post.body.startsWith("[answer-twice]"), answer)
            .tapIf((post: MailboxNotifyInput) => impersonating(post) && post.member === "eng.em", impersonate)
            .stepIf((post: MailboxNotifyInput) => impersonating(post) && post.member === "ops.lead", later)
            .tapIf((post: MailboxNotifyInput) => impersonating(post) && post.member === "ops.lead", answer)
            .stepIf(holding, keep)
            .stepIf(holding, later)
            .stepIf(holding, later)
            .tapIf(holding, answer)
            .tapIf(replaying, replay)
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
const appFlow = defineFlow({
  kind: "app",
  actions: { writeRow: { block: writeRow }, readRow: { block: readRow }, ...defineProjectBlocks().actions }
});

type Answer = { status: number; json: any };

/**
 * Boot a host over `stores`: the template's seats hired on the listening kind,
 * the mailbox kind built waking them, and `mailboxInstances` reading the org
 * template (when `talk` is given) from the resources.
 */
async function boot(options: {
  talk?: { seats: string[]; charter?: string };
  stores?: StoreRegistry;
  seats?: string[];
  /** Build the host's mailbox kind from a second `mailboxInstances` call made without `resources`. */
  laterCall?: boolean;
  /** Refuse the first wake of this seat, as a notify slot whose dispatch is refused would. */
  refuseOnce?: string;
}) {
  const heard: Heard[] = [];
  const kept: { postId?: string; token?: string } = {};
  const seats = mintSeats((options.seats ?? ["eng.em", "ops.lead", "chief-of-staff"]).map(seatRecord), {
    workerFlows: { listener: listeningKind(heard, kept) as never }
  });
  // Each boot stands for a fresh process: nothing declared or registered before it.
  forgetOrgTalkTemplate(projects);
  forgetTalkTemplate(projects);
  if (options.talk !== undefined) defineProjectsCollection({ talk: options.talk });
  const notify = (() => {
    const wake = wakeMemberSeats(seats);
    if (options.refuseOnce === undefined) return wake;
    let refused = false;
    const refuse = handler({
      name: "test-refuse-wake",
      inputSchema: mailboxNotifyInputSchema,
      outputSchema: z.unknown(),
      execute: () => {
        throw new Error("the wake was refused");
      }
    });
    return routerBlock({
      name: "test-refuse-once",
      inputSchema: mailboxNotifyInputSchema,
      routes: [wake, refuse],
      execute: (post: MailboxNotifyInput) => {
        if (refused || post.member !== options.refuseOnce) return wake;
        refused = true;
        return refuse;
      }
    } as never) as typeof wake;
  })();
  const kinds = { [MAILBOX_KIND]: defineMailboxFlow({ notify }) as never };
  const [first] = mailboxInstances([], { kinds, resources: { projects } });
  const [kind] = options.laterCall === true ? mailboxInstances([], { kinds }) : [first];
  // A roster with no template registers no mailbox kind at all; projects still talk on the built-in.
  const talkKind = kind ?? defineMailboxFlow({ notify })();
  const stores = options.stores ?? inMemoryStores();
  const state = createFlowState({
    flows: { app: appFlow(), [MAILBOX_KIND]: talkKind, ...Object.fromEntries(seats.map((seat) => [seat.id, seat])) },
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
  /** Run the talk fan-out again for a post already made, as an at-least-once redelivery of its hand-off would. */
  const replayFanOut = async (user: string, sessionId: string, input: unknown) => {
    const runtime: any = await state.getRuntime();
    const result: any = await runAction({
      flow: talkKind,
      actionName: "onTalkPosted",
      input,
      userId: user,
      orgId: ORG,
      sessionId,
      source: "internal",
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig }
    } as never);
    if (result?.error !== undefined) throw result.error;
  };
  return { heard, kept, call, openSession, ok, app, rowOf, until, sessionOf, replayFanOut, stores: runtimeStores };
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

  it("readies one talk session when createProject and the template both bind the creator", async () => {
    const h = await boot({ talk: { seats: ["eng.em"] } });
    await h.ok("alice", "app", h.app, "createProject", { id: "apollo", title: "Apollo", members: [] });
    const talk = await h.sessionOf("apollo", "alice");
    // Both binds have run once each dispatched child exists; give the slower one time to land.
    await new Promise((r) => setTimeout(r, 200));
    const all = await h.stores.session.list({ parentage: "all" });
    const children = all.filter((record) => record.parentSessionId === h.app);
    expect(children.map((record) => record.id)).toEqual([talk]);
    expect((await h.rowOf("apollo"))!.sessions).toEqual([{ sessionId: talk, userId: "alice" }]);
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
    const bobTalk = (await h.ok("bob", MAILBOX_KIND, await h.openSession("bob", MAILBOX_KIND), "join", { projectId: "apollo" }))
      .sessionId as string;

    await h.ok("alice", MAILBOX_KIND, aliceTalk, "post", { body: "first" });
    await h.until(async () => (h.heard.length === 3 ? true : undefined), "three wakes for alice's first post");
    await h.ok("alice", MAILBOX_KIND, aliceTalk, "post", { body: "[answer] second" });
    await h.ok("bob", MAILBOX_KIND, bobTalk, "post", { body: "third" });
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
      expect(run.post.mailboxId).toBe(run.post.body === "third" ? bobTalk : aliceTalk);
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
      const page = await h.ok("bob", MAILBOX_KIND, bobTalk, "read", { after: 0 });
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

  it("lands one answer per seat per post when a delivery is answered twice", async () => {
    const h = await boot({ talk: { seats: ["eng.em", "ops.lead"] } });
    await h.ok("alice", "app", h.app, "writeRow", { id: "apollo", members: ["alice"] });
    const talk = await h.sessionOf("apollo", "alice");
    await h.ok("alice", MAILBOX_KIND, talk, "post", { body: "[answer-twice] once please" });
    await h.until(async () => (h.heard.length === 2 ? true : undefined), "two wakes");
    // Each seat answers its delivery twice: wait for both seats' first answers, then give any second one time to land.
    await h.until(async () => {
      const page = await h.ok("alice", MAILBOX_KIND, talk, "read", { after: 0 });
      return page.lines.filter((line: { author: string | null }) => line.author !== null).length >= 2 ? true : undefined;
    }, "both seats' answers");
    await new Promise((r) => setTimeout(r, 200));
    const page = await h.ok("alice", MAILBOX_KIND, talk, "read", { after: 0 });
    const answers = page.lines.filter((line: { author: string | null }) => line.author !== null);
    expect(answers.map((line: { author: string }) => line.author).sort()).toEqual(["eng.em", "ops.lead"]);
  });

  it("wakes the seats, with the charter, from a mailbox kind built by a later call that passed no resources", async () => {
    const h = await boot({ talk: { seats: ["eng.em", "ops.lead"], charter: "Plan the work." }, laterCall: true });
    await h.ok("alice", "app", h.app, "writeRow", { id: "apollo", members: ["alice"] });
    const talk = await h.sessionOf("apollo", "alice");
    await h.ok("alice", MAILBOX_KIND, talk, "post", { body: "hello" });
    await h.until(async () => (h.heard.length === 2 ? true : undefined), "both seats woken");
    expect(h.heard.map((run) => run.seat).sort()).toEqual(["eng.em", "ops.lead"]);
    expect(await h.ok("alice", MAILBOX_KIND, talk, "read", { after: 0 })).toMatchObject({
      charter: "Plan the work.",
      seats: ["eng.em", "ops.lead"]
    });
  });

  it("lands every seat's answer for a member whose talk session was created holding forged answer claims", async () => {
    const h = await boot({ talk: { seats: ["eng.em", "ops.lead"] } });
    await h.ok("alice", "app", h.app, "writeRow", { id: "apollo", members: ["alice", "bob"] });
    // Bob creates his session seeding claims for the room's next posts, then makes it his talk session.
    const forged: Record<string, number> = {};
    for (let seq = 0; seq <= 4; seq += 1) {
      for (const seat of ["eng.em", "ops.lead"]) forged[JSON.stringify([roomLineKey("apollo", seq), seat])] = seq;
    }
    const created = await h.call("POST", "bob", [MAILBOX_KIND, "sessions"], {
      userId: "bob",
      state: { talkAnsweredPosts: forged }
    });
    const seeded = created.json.session.id as string;
    expect((await h.ok("bob", MAILBOX_KIND, seeded, "join", { projectId: "apollo" })).sessionId).toBe(seeded);

    await h.ok("bob", MAILBOX_KIND, seeded, "post", { body: "[answer] status?" });
    const page = await h.until(async () => {
      const read = await h.ok("bob", MAILBOX_KIND, seeded, "read", { after: 0 });
      return read.lines.filter((line: { author: string | null }) => line.author !== null).length === 2 ? read : undefined;
    }, "both seats' answers despite the forged claims");
    const answers = page.lines.filter((line: { author: string | null }) => line.author !== null);
    expect(answers.map((line: { author: string }) => line.author).sort()).toEqual(["eng.em", "ops.lead"]);
  });

  it("refuses a seat answering as another seat, leaving that seat's answer to land as its own", async () => {
    const h = await boot({ talk: { seats: ["eng.em", "ops.lead"] } });
    await h.ok("alice", "app", h.app, "writeRow", { id: "apollo", members: ["alice"] });
    const talk = await h.sessionOf("apollo", "alice");
    // eng.em answers at once, as ops.lead; ops.lead answers for itself a moment later.
    await h.ok("alice", MAILBOX_KIND, talk, "post", { body: "[impersonate] who is on call?" });
    const page = await h.until(async () => {
      const read = await h.ok("alice", MAILBOX_KIND, talk, "read", { after: 0 });
      return read.lines.some((line: { author: string | null }) => line.author !== null) ? read : undefined;
    }, "ops.lead's answer");
    await new Promise((r) => setTimeout(r, 100));
    const answers = (await h.ok("alice", MAILBOX_KIND, talk, "read", { after: 0 })).lines.filter(
      (line: { author: string | null }) => line.author !== null
    );
    // The forged answer claimed nothing: ops.lead's slot holds its own words, and eng.em wrote no line.
    expect(answers).toEqual([expect.objectContaining({ author: "ops.lead", body: "noted: [impersonate] who is on call?" })]);
    expect(page.lines.some((line: { body: string }) => line.body.startsWith("forged"))).toBe(false);
  });

  it("refuses a delivery's token answered through another member's talk session, leaving the answer to land under the poster", async () => {
    const h = await boot({ talk: { seats: ["eng.em"] } });
    await h.ok("alice", "app", h.app, "writeRow", { id: "apollo", members: ["alice", "bob"] });
    const talk = await h.sessionOf("apollo", "alice");
    const bobs = await h.openSession("bob", MAILBOX_KIND);
    expect((await h.ok("bob", MAILBOX_KIND, bobs, "join", { projectId: "apollo" })).sessionId).toBe(bobs);

    // eng.em keeps the token of alice's post and answers it a moment later. Meanwhile bob
    // posts, and eng.em, woken under bob, answers alice's post with that token through bob's session.
    await h.ok("alice", MAILBOX_KIND, talk, "post", { body: "[hold] who is on call?" });
    await h.until(async () => (h.kept.token === undefined ? undefined : true), "eng.em keeping alice's token");
    await h.ok("bob", MAILBOX_KIND, bobs, "post", { body: "[replay] me too" });
    await h.until(async () => {
      const read = await h.ok("alice", MAILBOX_KIND, talk, "read", { after: 0 });
      return read.lines.some((line: { author: string | null }) => line.author !== null) ? true : undefined;
    }, "eng.em's answer");
    await new Promise((r) => setTimeout(r, 700));
    const answers = (await h.ok("alice", MAILBOX_KIND, talk, "read", { after: 0 })).lines.filter(
      (line: { author: string | null }) => line.author !== null
    );
    // The replay claimed nothing: the one line is under alice, the poster, in the genuine words.
    expect(answers).toEqual([
      expect.objectContaining({ author: "eng.em", userId: "alice", body: "noted: [hold] who is on call?" })
    ]);
  }, 15_000);

  it("wakes a seat whose delivery an earlier run recorded but never dispatched, once, with that delivery's token", async () => {
    const h = await boot({ talk: { seats: ["eng.em"] } });
    await h.ok("alice", "app", h.app, "writeRow", { id: "apollo", members: ["alice"] });
    const talk = await h.sessionOf("apollo", "alice");
    // An earlier run of this post's fan-out recorded eng.em's delivery and died before waking it.
    const postId = roomLineKey("apollo", 1);
    await h.stores.resourceState.set(
      "org",
      ORG,
      `room-deliveries/${postId}/eng.em/${talk}`,
      { projectId: "apollo", postId, seat: "eng.em", sessionId: talk, token: "t-crashed", status: "pending" } as never,
      "any"
    );

    await h.ok("alice", MAILBOX_KIND, talk, "post", { body: "[answer] who is on call?" });
    await h.until(async () => (h.heard.length === 1 ? true : undefined), "eng.em's wake");
    await h.until(async () => {
      const read = await h.ok("alice", MAILBOX_KIND, talk, "read", { after: 0 });
      return read.lines.some((line: { author: string | null }) => line.author === "eng.em") ? true : undefined;
    }, "eng.em's answer under the recorded token");
    await new Promise((r) => setTimeout(r, 200));
    expect(h.heard.map((run) => [run.seat, run.post.answerToken])).toEqual([["eng.em", "t-crashed"]]);
  });

  it("refuses a post through a talk session the project does not list for its owner", async () => {
    const h = await boot({ talk: { seats: ["eng.em"] } });
    await h.ok("alice", "app", h.app, "writeRow", { id: "apollo", members: ["alice"] });
    await h.sessionOf("apollo", "alice");
    // A second session of alice's, seeded as bound to the project but never listed on the row.
    const created = await h.call("POST", "alice", [MAILBOX_KIND, "sessions"], { userId: "alice", state: { resourceId: "apollo" } });
    const stray = created.json.session.id as string;
    await expect(h.ok("alice", MAILBOX_KIND, stray, "post", { body: "from a side window" })).rejects.toThrow(
      /talk-session-not-listed/
    );
    await expect(h.ok("alice", MAILBOX_KIND, stray, "read", { after: 0 })).rejects.toThrow(/talk-session-not-listed/);
    await new Promise((r) => setTimeout(r, 100));
    expect(h.heard).toEqual([]);
  });

  it("leaves a delivery whose wake was refused pending, so the replay wakes that seat once", async () => {
    const h = await boot({ talk: { seats: ["eng.em", "ops.lead"] }, refuseOnce: "eng.em" });
    await h.ok("alice", "app", h.app, "writeRow", { id: "apollo", members: ["alice"] });
    const talk = await h.sessionOf("apollo", "alice");
    const line = await h.ok("alice", MAILBOX_KIND, talk, "post", { body: "who is on call?" });
    // ops.lead is woken; eng.em's wake was refused, and that refusal does not hold up ops.lead's.
    await h.until(async () => (h.heard.length === 1 ? true : undefined), "ops.lead's wake");
    await new Promise((r) => setTimeout(r, 200));
    expect(h.heard.map((run) => run.seat)).toEqual(["ops.lead"]);
    const statusOf = async (seat: string) =>
      ((await h.stores.resourceState.get("org", ORG, `room-deliveries/${roomLineKey("apollo", line.seq)}/${seat}/${talk}`))
        ?.state as { status?: string; token?: string } | undefined);
    expect((await statusOf("eng.em"))?.status).toBe("pending");
    expect((await statusOf("ops.lead"))?.status).toBe("delivered");

    // The replay wakes eng.em, with its recorded token, and not ops.lead again.
    await h.replayFanOut("alice", talk, { projectId: "apollo", seq: line.seq, body: line.body, principal: "alice" }).catch(() => undefined);
    await h.until(async () => (h.heard.length === 2 ? true : undefined), "eng.em's wake on the replay");
    await new Promise((r) => setTimeout(r, 200));
    expect(h.heard.map((run) => run.seat)).toEqual(["ops.lead", "eng.em"]);
    expect(h.heard[1]!.post.answerToken).toBe((await statusOf("eng.em"))?.token);
    expect((await statusOf("eng.em"))?.status).toBe("delivered");
  });

  it("wakes each seat once when the fan-out for one post runs twice", async () => {
    const h = await boot({ talk: { seats: ["eng.em", "ops.lead"] } });
    await h.ok("alice", "app", h.app, "writeRow", { id: "apollo", members: ["alice"] });
    const talk = await h.sessionOf("apollo", "alice");
    const line = await h.ok("alice", MAILBOX_KIND, talk, "post", { body: "who is on call?" });
    await h.until(async () => (h.heard.length === 2 ? true : undefined), "the post's two wakes");

    // The same post's fan-out, delivered again.
    await h.replayFanOut("alice", talk, { projectId: "apollo", seq: line.seq, body: line.body, principal: "alice" });
    await new Promise((r) => setTimeout(r, 300));
    expect(h.heard.map((run) => run.seat).sort()).toEqual(["eng.em", "ops.lead"]);
  });

  it("reaches an existing talk session with an edited template at the next boot", async () => {
    const stores = inMemoryStores();
    const before = await boot({ stores, talk: { seats: ["eng.em"], charter: "Old charter." } });
    await before.ok("alice", "app", before.app, "writeRow", { id: "apollo", members: ["alice"] });
    const talk = await before.sessionOf("apollo", "alice");
    await before.ok("alice", MAILBOX_KIND, talk, "post", { body: "before the edit" });
    await before.until(async () => (before.heard.length === 1 ? true : undefined), "one wake before the edit");

    // The same store, restarted with a seat added and the charter rewritten.
    const after = await boot({ stores, talk: { seats: ["eng.em", "ops.lead"], charter: "New charter." } });
    await after.ok("alice", MAILBOX_KIND, talk, "post", { body: "after the edit" });
    await after.until(async () => (after.heard.length === 2 ? true : undefined), "two wakes after the edit");
    expect(after.heard.map((run) => run.seat).sort()).toEqual(["eng.em", "ops.lead"]);
    const page = await after.ok("alice", MAILBOX_KIND, talk, "read", { after: 0 });
    expect(page).toMatchObject({ charter: "New charter.", seats: ["eng.em", "ops.lead"] });
    expect(page.lines.map((line: { body: string }) => line.body)).toEqual(["before the edit", "after the edit"]);
  });
});
