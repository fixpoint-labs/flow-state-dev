/**
 * A fresh app with a routed support mailbox, as a new app would write it.
 *
 * Everything here comes from the published packages and the team's files: no
 * kitchen-sink code, and no dispatcher or router of the app's own. The wake is
 * `wakeMemberSeats(copies, { installation })` in the built-in mailbox kind's
 * notify slot, and the route is `routeByPurpose(copies, { model, installation })`.
 * Every worker flow is registered once, and a woken worker's conversation is a
 * session on its flow, naming it. A mailbox that declares
 * `routing:` in its file is routed; one that doesn't wakes every agent member.
 * The goal check reads this file's source to hold it to that.
 *
 * Keyless by default: the seats answer from a scripted model, and the route's
 * one evaluation is scripted by its block name, `mailbox-route`. The scripts
 * are the app's test doubles, and they answer from what they are handed:
 *
 * - the route: a post naming `[route:<member>]` goes to that member; a post
 *   marked `[follow-up]` goes to whoever last spoke in the lines the route
 *   read; anything else fails the call, so the mailbox's fallback takes it.
 * - an answer: `[answer:none]` replies with nothing; `[answer:from-context]`
 *   names the `item-…` it finds in the recent lines it was shown; anything
 *   else acknowledges the post's `tok-…`. Every reply carries
 *   {@link REPLY_MARKER}. No answer calls the post tool.
 *
 * `seams` is the goal check's, for its controls and its live leg, and nothing
 * else. An app passes nothing.
 */
import { createSessionClient } from "@flow-state-dev/client";
import type { BlockDefinition } from "@flow-state-dev/core";
import type { EvaluationModel, FlowInstance, ModelResolver } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, type FlowState } from "@flow-state-dev/engine";
import {
  createMockModelResolver,
  mockEvaluationModel,
  type MockEvaluationCall,
  type MockGeneratorInstance,
  type MockGeneratorScriptStep
} from "@flow-state-dev/testing";
import {
  mailboxInstances,
  createWorkerInstallation,
  defineMailboxFlow,
  hireWorkforce,
  openMailboxes,
  routeByPurpose,
  wakeMemberSeats,
  type MailboxManifest,
  type WorkerInstallation
} from "@flow-state-dev/workforce";
import { readMailboxesDirectory, readWorkforce } from "@flow-state-dev/workforce/loader";

/** The user the mailboxes are opened under, and who posts to them. */
export const MAILBOX_OWNER = "u_routed_host";

/** What every scripted answer carries. */
export const REPLY_MARKER = "[reply:routed-host]";

/** The evaluation model the app routes with, named once, resolved by the app's resolver. */
export const ROUTE_MODEL = "vercel/typesafe-ai/jev";

/** The goal check's seams. An app passes none. */
export interface HostSeams {
  /** The mailbox files as the host reads them, before anything is built. */
  adaptMailboxes?: (mailboxes: MailboxManifest[]) => MailboxManifest[];
  /** Worker flows the app registers beside the built-ins, by name, built on the installation. */
  kinds?: (installation: WorkerInstallation) => Record<string, unknown>;
  /** The wake the mailbox's notify slot runs. */
  adaptNotify?: (wake: BlockDefinition<any, any>) => BlockDefinition<any, any>;
  /** The route's scripted evaluation model, as the resolver hands it over. */
  adaptEvaluation?: (model: EvaluationModel) => EvaluationModel;
  /** Real models: this resolver resolves the route's model and the seats' answers. */
  live?: { modelResolver: ModelResolver };
}

/** The app, booted. */
export interface RoutedHost {
  state: FlowState;
  router: Awaited<ReturnType<FlowState["getRouter"]>>;
  seats: FlowInstance[];
  mailboxes: MailboxManifest[];
  /** Every call the scripted route evaluation received. Empty on the live leg. */
  routeCalls: MockEvaluationCall[];
}

/** The text of a model message's content. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  return Array.isArray(content) ? content.map((part) => (part as { text?: string }).text ?? "").join("") : "";
}

/** The route's scripted evaluation. Reads the `{ recent, post }` state the route hands it. */
function scriptedRoute() {
  return mockEvaluationModel({
    answers: ({ state }) => {
      const { recent = [], post } = state as {
        recent?: Array<{ from: string; text: string }>;
        post: { from: string; text: string };
      };
      const named = /\[route:([^\]\s]+)\]/.exec(post.text)?.[1];
      if (named !== undefined) return { member: { type: "choice", choice: named } };
      if (post.text.includes("[follow-up]")) {
        const last = [...recent].reverse().find((line) => line.from !== post.from);
        if (last !== undefined) return { member: { type: "choice", choice: last.from } };
      }
      throw new Error("the scripted route has no member for this post");
    }
  });
}

/** The seats' scripted answer. Never calls a tool. */
function scriptedAnswer(): MockGeneratorInstance {
  return {
    name: "agent-answer",
    calls: [],
    reset: () => {},
    next: (input: unknown): MockGeneratorScriptStep => {
      const messages = input as Array<{ role: string; content: unknown }>;
      const turn = textOf([...messages].reverse().find((m) => m.role === "user")?.content);
      const system = messages.filter((m) => m.role === "system").map((m) => textOf(m.content)).join("\n");
      if (turn.includes("[answer:none]")) return { text: "" };
      const token = /tok-[a-z0-9]+/.exec(turn)?.[0] ?? "";
      if (turn.includes("[answer:from-context]")) {
        const item = /item-[a-z0-9]+/.exec(system)?.[0];
        return { text: `${REPLY_MARKER} ${token} ${item === undefined ? "Buy what?" : `You can buy the ${item} at the shop.`}` };
      }
      return { text: `${REPLY_MARKER} ${token} noted.` };
    }
  };
}

/**
 * Read the team's files, hire its seats, build its mailboxes with the wake and
 * the route, and open them.
 *
 * @param tree The workforce root to read.
 * @param seams The goal check's seams. An app passes nothing.
 */
export async function startRoutedHost(tree: string, seams: HostSeams = {}): Promise<RoutedHost> {
  const { workers, errors } = await readWorkforce(tree);
  const read = await readMailboxesDirectory(tree);
  if (errors.length > 0 || read.errors.length > 0) {
    throw new Error(`the tree did not load: ${[...errors, ...read.errors].map((e) => `${e.path}: ${String(e.error)}`).join(", ")}`);
  }
  const mailboxes = seams.adaptMailboxes?.(read.mailboxes) ?? read.mailboxes;

  // The flows first: the wake and the route reach the workers on these copies,
  // never a mailbox's stored members.
  let flows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({ standardWorkers: workers, workerFlows: () => flows as never });
  flows = seams.kinds?.(installation) ?? {};
  const seats = hireWorkforce(installation);
  const wake = wakeMemberSeats(seats, { installation });
  const mailboxFlows = mailboxInstances(mailboxes, {
    kinds: {
      mailbox: defineMailboxFlow({
        notify: seams.adaptNotify?.(wake) ?? wake,
        route: routeByPurpose(seats, { model: ROUTE_MODEL, installation })
      })
    }
  });

  const route = scriptedRoute();
  const state = createFlowState({
    flows: {
      ...Object.fromEntries(mailboxFlows.map((flow) => [flow.kind, flow])),
      ...Object.fromEntries(seats.map((seat) => [seat.id, seat]))
    },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver:
      seams.live?.modelResolver ??
      createMockModelResolver({
        generators: { "agent-answer": scriptedAnswer() },
        evaluators: { "mailbox-route": seams.adaptEvaluation?.(route) ?? route },
        policy: "allow"
      })
  } as never);
  const router = await state.getRouter();

  // The session client over the app's own router: the app is the server.
  const sessions = createSessionClient({
    fetcher: async (input, init) => {
      const url = new URL(String(input), "http://routed-host.local");
      const path = url.pathname
        .replace(/^\/api\/flows\/?/, "")
        .split("/")
        .filter((segment) => segment.length > 0)
        .map(decodeURIComponent);
      const method = (init?.method ?? "GET").toUpperCase() as "GET" | "POST" | "PATCH" | "DELETE";
      return await router[method](new Request(url, init), { params: { path } });
    }
  });
  await openMailboxes(mailboxes, { client: sessions, userId: MAILBOX_OWNER });

  return { state, router, seats, mailboxes, routeCalls: seams.live === undefined ? route.calls : [] };
}
