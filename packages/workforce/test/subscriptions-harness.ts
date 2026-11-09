/**
 * A host for subscriptions on the real engine (FIX-2534): the board host's
 * worker flows, a `follower` worker flow whose sessions subscribe (its
 * actions are the four routine verbs a worker's tools run, so a test calls them
 * as a model would, with no model), and a GitHub service flow that routes
 * events. Two workers run on it: `eng.follower`, and `eng.watcher`, another
 * worker of the same user. Two scripted generators sit on it too: `chat` uses
 * the routines capability, `chat-plain` doesn't. The routines' providers are
 * the GitHub one, given to `hireWorkforce` as an app gives them.
 *
 * `route(event)` is what an ingestion does: it runs the service flow's routing
 * entry as the service, then each owner run it names, through the host
 * (`routeServiceEvent`), and waits for them and the messages they send.
 */
import { defineFlow, generator, handler } from "@flow-state-dev/core";
import type { BlockContext, FlowInstance, SubscriptionEvent } from "@flow-state-dev/core/types";
import { routeServiceEvent } from "@flow-state-dev/engine/internal";
import { runAction } from "@flow-state-dev/engine";
import { type InboundTransportHost } from "@flow-state-dev/engine/host";
import { z } from "zod";
import { MESSAGE_RECEIVED_ENTRY } from "../src/messages/keys";
import { WORKER_MESSAGES_PATTERN } from "../src/messages/log-row";
import { workerMessagesResources } from "../src/messages/message-log";
import { messageReceivedEntry } from "../src/messages/message-received-entry";
import { workerTaskEntry } from "../src/conversation-board/task-entry";
import {
  SUBSCRIPTION_CURSORS_PATTERN,
  SUBSCRIPTIONS_PATTERN,
  defineSubscriptionServiceFlow,
  subscribe,
  subscriptionResources,
  type SubscriptionProvider,
  type SubscriptionServiceOptions
} from "../src/subscriptions";
import { createRoutinesCapability } from "../src/routines";
import { workerRoutineVerbs } from "../src/routines/routines";
import type { WorkerManifest } from "../src/manifest";
import { workerConfigSchema } from "../src/worker-config";
import type { WorkerInstallation } from "../src/workers/installation";
import { boardWorkers, bootBoardHost, ORG, type BoardHostOptions } from "./conversation-board-harness";

/** Users whose read access to private threads a test has taken away. */
export const revoked = new Set<string>();

/** Threads a user can read: any public one, and a private one only alice, until her access is revoked. */
function readableBy(userId: string, thread: string): boolean {
  return !thread.includes("/private") || (userId === "alice" && !revoked.has(userId));
}

/** The GitHub provider the host is built with: read access by {@link readableBy}, the user's GitHub login `<user>-gh`. */
export const github: SubscriptionProvider = {
  provider: "github",
  canRead: (thread, ctx: BlockContext) => readableBy((ctx.session.identity as { userId: string }).userId, thread),
  self: (ctx: BlockContext) => `${(ctx.session.identity as { userId: string }).userId}-gh`
};

const doorInput = z.object({ message: z.string() });

function followerFlow(installation: WorkerInstallation, hold: Promise<void> | undefined, isolated: boolean) {
  const tools = workerRoutineVerbs(installation);
  // A worker's turn on a model: one with the routines capability, one without.
  const chat = generator({ name: "follower-chat", model: "scripted/follower", prompt: "You keep routines for this user.", inputSchema: doorInput, uses: [createRoutinesCapability(installation)], user: (input) => input.message, itemVisibility: { client: true, history: true } });
  const chatPlain = generator({ name: "follower-chat-plain", model: "scripted/follower", prompt: "You keep routines for this user.", inputSchema: doorInput, user: (input) => input.message, itemVisibility: { client: true, history: true } });
  // A task's turn: `[subscribe:<thread>]` subscribes the task's session to it, `[hold]` waits on the
  // host's hold, then `[fail]` fails the task.
  const door = handler({
    name: "follower-run",
    inputSchema: doorInput,
    resources: subscriptionResources,
    execute: async (input, ctx) => {
      const asked = /\[subscribe:([^\]]+)\]/.exec(input.message);
      if (asked !== null) {
        const outcome = await subscribe(ctx as never, [github], { provider: "github", thread: asked[1]!, interest: "the task's PR" });
        if ("refused" in outcome) throw new Error(outcome.refused);
      }
      if (input.message.includes("[hold]")) await hold;
      if (input.message.includes("[fail]")) throw new Error("the task failed");
      return "ok";
    }
  });
  return defineFlow({
    kind: "follower",
    ...(isolated ? { isolateUserState: true } : {}),
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources, ...workerMessagesResources, ...subscriptionResources },
    actions: {
      respond: { inputSchema: doorInput, block: door, userMessage: (i: { message: string }) => i.message },
      // Not doors: `respond` is the flow's one door; these are a test's way onto a model turn.
      chat: { inputSchema: doorInput, block: chat },
      chatPlain: { inputSchema: doorInput, block: chatPlain },
      ...Object.fromEntries([tools.listRoutines, tools.saveRoutine, tools.pauseRoutine, tools.deleteRoutine].map((block) => [block.name, { inputSchema: block.inputSchema, block }]))
    },
    // No turn: a message lands as its items and nothing runs, so no model is asked.
    internal: { actions: { [MESSAGE_RECEIVED_ENTRY]: messageReceivedEntry({ installation, flowKind: "follower" }) } },
    task: { actions: { work: workerTaskEntry({ name: "follower-task", turn: door }) } }
  });
}

export type SubscriptionsHostOptions = BoardHostOptions & {
  /** The service flow's options beside the provider and the installation. */
  service?: Partial<Omit<SubscriptionServiceOptions, "provider" | "installation" | "kind">>;
  /** What a `[hold]` task turn waits on. */
  hold?: Promise<void>;
  /** The follower flow isolates its users' state (`isolateUserState`). */
  isolatedFollower?: boolean;
  /** The service flow itself, in place of the one built from `service` (GitHub's own flow); its kind must be `github-service`. */
  serviceFlow?: (installation: WorkerInstallation) => FlowInstance;
};

/** A board host with followers and a GitHub service flow. */
export function bootSubscriptionsHost(options: SubscriptionsHostOptions = {}) {
  let host: InboundTransportHost | undefined;
  const standard: WorkerManifest[] = [
    ...boardWorkers({ lead: { delegates: ["eng.tasker", "eng.follower"] } }),
    { id: "eng.follower", declared: { flow: "follower", description: "Follows threads." }, body: "", skills: [] },
    { id: "eng.watcher", declared: { flow: "follower", description: "Watches threads." }, body: "", skills: [] },
    ...(options.standard ?? [])
  ];
  const board = bootBoardHost({
    ...options,
    hire: { ...options.hire, routines: { providers: [github], ...options.hire?.routines } },
    standard,
    // A coordinator's conversation keeps event routines too (its routine actions).
    coordinatorRoutines: options.coordinatorRoutines ?? true,
    flows: (installation) => ({ follower: { flow: followerFlow(installation, options.hold, options.isolatedFollower === true), roles: ["contributor"] }, ...(options.flows?.(installation) ?? {}) }),
    plainFlowsOf: (installation): Record<string, FlowInstance> => ({
      "github-service":
        options.serviceFlow?.(installation) ??
        defineSubscriptionServiceFlow({
          kind: "github-service",
          provider: github,
          installation,
          trustedBots: ["codex"],
          ...(options.service ?? {})
        })
    }),
    adapters: [{ source: "subscriptions-test", createBindings: (h: InboundTransportHost) => ((host = h), {}) }, ...(options.adapters ?? [])]
  });

  const hostOf = async () => {
    await board.router();
    return host!;
  };

  /** A follower conversation for `userId`, run by `worker`. */
  const follower = async (userId: string, worker = "eng.follower") => {
    const created = await board.create(userId, "follower", { state: { workerId: worker } });
    if (created.status !== 201 && created.status !== 200) throw new Error(`creating a follower failed (${created.status}): ${JSON.stringify(created.body)}`);
    return created.body.session!.id;
  };

  /** A follower conversation for `userId` under `tenantId`, created over HTTP with the tenant header; with `sessionId` as its id when given. */
  const followerInTenant = async (userId: string, tenantId: string, sessionId?: string) => {
    const request = new Request("http://localhost/api/flows/follower/sessions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user": userId, "x-tenant-id": tenantId },
      body: JSON.stringify({ userId, ...(sessionId === undefined ? {} : { sessionId }), state: { workerId: "eng.follower" } })
    });
    const res = await (await board.router()).POST(request, { params: { path: ["follower", "sessions"] } });
    const body = (await res.json()) as { session?: { id: string } };
    if (body.session === undefined) throw new Error(`creating a tenant's follower failed (${res.status}): ${JSON.stringify(body)}`);
    return body.session.id;
  };

  /** A routine tool's answer, as the subscription it wrote: its id, or why it was refused. */
  const asSubscription = (output: unknown): { id: string } | { refused: string } => {
    const answer = output as { ok: true; routine: { id: string } } | { ok: false; error: string };
    return answer.ok ? { id: answer.routine.id.replace(/^event:/, "") } : { refused: answer.error };
  };

  /** Save an event routine as `userId` in `sessionId`, as a model would; under `tenantId` when given; on `flow` (a follower's by default). */
  const subscribe = async (userId: string, sessionId: string, input: Record<string, unknown>, tenantId?: string, flow = "follower") => {
    const tool = { trigger: { event: { provider: "github", interest: "what happens on it", ...input } } };
    if (tenantId === undefined) return asSubscription((await board.act(userId, sessionId, "saveRoutine", tool, flow)).output);
    const runtime = await board.state.getRuntime();
    const ran = (await runAction({
      flow: board.instances.follower!,
      actionName: "saveRoutine",
      input: tool,
      userId,
      orgId: ORG,
      tenantId,
      sessionId,
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig }
    })) as { output?: unknown };
    return asSubscription(ran.output);
  };

  /** Delete an event routine as `userId` in `sessionId`, by its subscription id. */
  const unsubscribe = async (userId: string, sessionId: string, id: string) => {
    const answer = (await board.act(userId, sessionId, "deleteRoutine", { id: `event:${id}` }, "follower")).output as { ok: true } | { ok: false; error: string };
    return answer.ok ? { ended: id } : { refused: answer.error };
  };

  /** Route one event as an ingestion would, and wait for everything it started. */
  const route = async (event: SubscriptionEvent) => {
    const routed = await routeServiceEvent(await hostOf(), {
      flowKind: "github-service",
      entry: "routeSubscriptionEvent",
      input: event,
      principal: { userId: "service:github", orgId: ORG }
    });
    if (routed.error !== undefined) throw new Error(`routing failed: ${JSON.stringify(routed.error)}`);
    await Promise.all(routed.ownerRuns.map((run) => run.finished));
    await board.settled();
    return routed;
  };

  /**
   * Route one event and wait only for its owner runs, not for the host to
   * settle: a test that holds another delivery's dispatch runs this beside it.
   */
  const routeBeside = async (event: SubscriptionEvent) => {
    const routed = await routeServiceEvent(await hostOf(), {
      flowKind: "github-service",
      entry: "routeSubscriptionEvent",
      input: event,
      principal: { userId: "service:github", orgId: ORG }
    });
    if (routed.error !== undefined) throw new Error(`routing failed: ${JSON.stringify(routed.error)}`);
    return Promise.all(routed.ownerRuns.map(async (run) => (await run.finished!).output as { act: string }));
  };

  /**
   * Hold the first `actionName` dispatch the host records until `release`:
   * `reached` resolves once a delivery waits there, its slot taken.
   * `release({ lose: true })` loses it, as a store that went down would.
   */
  const holdFirstDispatch = async (actionName: string) => {
    const store = (await board.state.getRuntime()).stores.request;
    const set = store.set.bind(store);
    let held = false;
    let reach!: () => void;
    let release!: (lose: boolean) => void;
    const reached = new Promise<void>((resolve) => (reach = resolve));
    const released = new Promise<boolean>((resolve) => (release = resolve));
    store.set = (async (id: string, record: { actionName?: string }, ...rest: unknown[]) => {
      if (!held && record.actionName === actionName) {
        held = true;
        reach();
        if (await released) throw new Error(`the store is down: request ${id} was not recorded`);
      }
      return (set as (...args: unknown[]) => Promise<unknown>)(id, record, ...rest);
    }) as typeof store.set;
    return {
      reached,
      release: (how: { lose?: boolean } = {}) => {
        store.set = set as typeof store.set;
        release(how.lose === true);
      }
    };
  };

  /**
   * Fail the first write of a service message's take (`takenBy`): the
   * recipient's request was accepted and then failed before taking it.
   */
  const failFirstTake = async () => {
    const store = (await board.state.getRuntime()).stores.resourceState;
    const set = store.set.bind(store);
    const prefix = WORKER_MESSAGES_PATTERN.replace("*", "");
    let failed = 0;
    store.set = (async (scopeType, scopeId, key, state, expected) => {
      const row = state as { takenBy?: unknown; from?: unknown };
      if (failed === 0 && key.startsWith(prefix) && row.takenBy !== undefined && String(row.from).startsWith("service:")) {
        failed += 1;
        throw new Error("the store is down: the take was not written");
      }
      return set(scopeType, scopeId, key, state, expected);
    }) as typeof store.set;
    return {
      failed: () => failed,
      restore: () => {
        store.set = set as typeof store.set;
      }
    };
  };

  /** The service's messages that landed in `sessionId`, as the model reads them. */
  const heard = async (sessionId: string) => (await board.messages(sessionId)).filter((m) => m.text.startsWith("From service:")).map((m) => m.text);

  /** `userId`'s subscription rows, from the store. */
  const subscriptionRows = async (userId: string) => {
    const runtime = await board.state.getRuntime();
    const prefix = SUBSCRIPTIONS_PATTERN.replace("*", "");
    const entries = await runtime.stores.resourceState.getByPrefix("user", `${userId}:~org:${ORG}`, prefix);
    return Object.values(entries).map((value) => value.state as Record<string, any>);
  };

  /** One subscription's cursor row, from the store. */
  const cursorOf = async (userId: string, id: string) => {
    const runtime = await board.state.getRuntime();
    const row = await runtime.stores.resourceState.get("user", `${userId}:~org:${ORG}`, `${SUBSCRIPTION_CURSORS_PATTERN.replace("*", "")}${id}`);
    return row?.state as Record<string, any>;
  };

  /** `userId`'s message log rows from the service, from the store. */
  const serviceRows = async (userId: string) => {
    const runtime = await board.state.getRuntime();
    const entries = await runtime.stores.resourceState.getByPrefix("user", `${userId}:~org:${ORG}`, WORKER_MESSAGES_PATTERN.replace("*", ""));
    return Object.values(entries)
      .map((value) => value.state as Record<string, any>)
      .filter((row) => typeof row.from === "string" && row.from.startsWith("service:"));
  };

  return { ...board, hostOf, follower, followerInTenant, subscribe, unsubscribe, route, routeBeside, holdFirstDispatch, failFirstTake, heard, subscriptionRows, cursorOf, serviceRows };
}

export type SubscriptionsHost = ReturnType<typeof bootSubscriptionsHost>;

let seq = 0;

/** A review on `acme/api#412` by a member, unless `fields` says otherwise. */
export function event(fields: Partial<SubscriptionEvent> = {}): SubscriptionEvent {
  seq += 1;
  return {
    provider: "github",
    threads: ["github:acme/api", "github:acme/api#412"],
    kind: "review",
    object: { id: `review-${seq}`, version: 1 },
    sender: { id: "octocat", name: "The Octocat", role: "member" },
    audience: "public",
    title: "Review on #412",
    text: "One nit on the error path.",
    labels: [],
    url: "https://github.com/acme/api/pull/412",
    received: Date.now(),
    at: Date.now(),
    deliveryId: `delivery-${seq}`,
    ...fields
  };
}
