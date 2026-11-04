/**
 * A host for subscriptions on the real engine (FIX-2534): the board host's
 * worker flows, a `follower` worker flow whose sessions subscribe (its
 * actions are the two subscription tools, so a test calls them as a model
 * would, with no model), and a GitHub service flow that routes events.
 *
 * `route(event)` is what an ingestion does: it runs the service flow's routing
 * entry as the service, then each owner run it names, through the host
 * (`routeServiceEvent`), and waits for them and the messages they send.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import type { BlockContext, FlowInstance, SubscriptionEvent } from "@flow-state-dev/core/types";
import { routeServiceEvent, type InboundTransportHost } from "@flow-state-dev/engine";
import { z } from "zod";
import { MESSAGE_RECEIVED_ENTRY } from "../src/messages/keys";
import { workerMessagesResources } from "../src/messages/message-log";
import { messageReceivedEntry } from "../src/messages/message-received-entry";
import { workerTaskEntry } from "../src/conversation-board/task-entry";
import {
  SUBSCRIPTION_CURSORS_PATTERN,
  SUBSCRIPTION_ROUTE_ENTRY,
  SUBSCRIPTIONS_PATTERN,
  defineSubscriptionServiceFlow,
  subscribe,
  subscriptionResources,
  subscriptionTools,
  type SubscriptionProvider,
  type SubscriptionServiceOptions
} from "../src/subscriptions";
import type { WorkerManifest } from "../src/manifest";
import { workerConfigSchema } from "../src/worker-config";
import type { WorkerInstallation } from "../src/workers/installation";
import { boardWorkers, bootBoardHost, ORG, type BoardHostOptions } from "./conversation-board-harness";

export { ORG };

/** Users whose read access to private threads a test has taken away. */
export const revoked = new Set<string>();

/** Threads a user can read: any public one, and a private one only alice, until her access is revoked. */
export function readableBy(userId: string, thread: string): boolean {
  return !thread.includes("/private") || (userId === "alice" && !revoked.has(userId));
}

/** The GitHub provider the host is built with: read access by {@link readableBy}, the user's GitHub login `<user>-gh`. */
export const github: SubscriptionProvider = {
  provider: "github",
  canRead: (thread, ctx: BlockContext) => readableBy((ctx.session.identity as { userId: string }).userId, thread),
  self: (ctx: BlockContext) => `${(ctx.session.identity as { userId: string }).userId}-gh`
};

const doorInput = z.object({ message: z.string() });

function followerFlow(installation: WorkerInstallation) {
  const tools = subscriptionTools({ providers: [github] });
  // A task's turn: `[subscribe:<thread>]` subscribes the task's session to it, then `[fail]` fails the task.
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
      if (input.message.includes("[fail]")) throw new Error("the task failed");
      return "ok";
    }
  });
  return defineFlow({
    kind: "follower",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources, ...workerMessagesResources, ...subscriptionResources },
    actions: {
      respond: { inputSchema: doorInput, block: door, userMessage: (i: { message: string }) => i.message },
      subscribe: { inputSchema: tools.subscribe.inputSchema, block: tools.subscribe },
      unsubscribe: { inputSchema: tools.unsubscribe.inputSchema, block: tools.unsubscribe }
    },
    // No turn: a message lands as its items and nothing runs, so no model is asked.
    internal: { actions: { [MESSAGE_RECEIVED_ENTRY]: messageReceivedEntry({ installation, flowKind: "follower" }) } },
    task: { actions: { work: workerTaskEntry({ name: "follower-task", turn: door }) } }
  });
}

export type SubscriptionsHostOptions = BoardHostOptions & {
  /** The service flow's options beside the provider and the installation. */
  service?: Partial<Omit<SubscriptionServiceOptions, "provider" | "installation" | "kind">>;
};

/** A board host with followers and a GitHub service flow. */
export function bootSubscriptionsHost(options: SubscriptionsHostOptions = {}) {
  let host: InboundTransportHost | undefined;
  const standard: WorkerManifest[] = [
    ...boardWorkers({ lead: { delegates: ["eng.tasker", "eng.follower"] } }),
    { id: "eng.follower", declared: { flow: "follower", description: "Follows threads." }, body: "", skills: [] }
  ];
  const board = bootBoardHost({
    ...options,
    standard,
    flows: (installation) => ({ follower: { flow: followerFlow(installation), roles: ["contributor"] }, ...(options.flows?.(installation) ?? {}) }),
    plainFlowsOf: (installation): Record<string, FlowInstance> => ({
      "github-service": defineSubscriptionServiceFlow({
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

  /** A follower conversation for `userId`. */
  const follower = async (userId: string) => {
    const created = await board.create(userId, "follower", { state: { workerId: "eng.follower" } });
    if (created.status !== 201 && created.status !== 200) throw new Error(`creating a follower failed (${created.status}): ${JSON.stringify(created.body)}`);
    return created.body.session!.id;
  };

  /** Call the subscribe tool as `userId` in `sessionId`, as a model would. */
  const subscribe = async (userId: string, sessionId: string, input: Record<string, unknown>) =>
    (await board.act(userId, sessionId, "subscribe", { provider: "github", interest: "what happens on it", ...input }, "follower")).output as
      | { id: string }
      | { refused: string };

  const unsubscribe = async (userId: string, sessionId: string, id: string) =>
    (await board.act(userId, sessionId, "unsubscribe", { id }, "follower")).output as { ended: string } | { refused: string };

  /** Route one event as an ingestion would, and wait for everything it started. */
  const route = async (event: SubscriptionEvent) => {
    const routed = await routeServiceEvent(await hostOf(), {
      flowKind: "github-service",
      entry: SUBSCRIPTION_ROUTE_ENTRY,
      input: event,
      principal: { userId: "service:github", orgId: ORG }
    });
    if (routed.error !== undefined) throw new Error(`routing failed: ${JSON.stringify(routed.error)}`);
    await Promise.all(routed.ownerRuns.map((run) => run.finished));
    await board.settled();
    return routed;
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

  return { ...board, hostOf, follower, subscribe, unsubscribe, route, heard, subscriptionRows, cursorOf };
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
