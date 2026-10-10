/**
 * A fresh app with a routed support coordinator, as a new app would write it.
 *
 * Everything here comes from the published packages and the team's files: no
 * kitchen-sink code, and no dispatcher or router of the app's own. The
 * coordinators are worker files (`flow: coordinator`); the routed one says
 * `routing: best-fit` and names its `fallback:`. The app registers
 * Workforce's `coordinator` flow once, with the built-in `agent` as the flow
 * its delegates take posts on, and names the model best fit's one evaluator
 * call runs on. Every worker flow is registered once, and a delegate's
 * conversation is a session on its flow, naming it. The app names its one
 * user and org in `resolvePrincipal`, so every session it makes, the
 * delegates' included, carries that org rather than the development default.
 * The goal check reads this file's source to hold it to that.
 *
 * Keyless by default: the delegates answer from a scripted model, and best
 * fit's one evaluation is scripted by its block name, `coordinator-route`.
 * The scripts are the app's test doubles, and they answer from what they are
 * handed:
 *
 * - the route: a post naming `[route:<delegate>]` goes to that delegate; one
 *   marked `[follow-up]` goes to whoever last wrote in the recent lines it is
 *   handed beside the post, other than the post's writer; anything else fails
 *   the call, so the coordinator's fallback takes it.
 * - an answer: `[answer:none]` replies with nothing, which is a turn with no
 *   answer; `[answer:from-context]` names the `item-…` it finds in the
 *   conversation's lines, the user-role message just before the post (never
 *   the system text); anything else acknowledges the post's `tok-…`. Every
 *   reply carries {@link REPLY_MARKER}.
 *
 * `seams` is the goal check's, for its controls and its live leg, and nothing
 * else. An app passes nothing.
 */
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
  createWorkerInstallation,
  defineAgentWorkerFlow,
  defineCoordinatorFlow,
  hireWorkforce,
  type WorkerInstallation,
  type WorkerManifest
} from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";

/** The user who talks to the coordinators. */
export const OWNER = "u_routed_host";

/** The organization the app runs as. Every session it makes carries it. */
export const ORG = "org_routed_host";

/** What every scripted answer carries. */
export const REPLY_MARKER = "[reply:routed-host]";

/** The evaluation model the app routes with, named once, resolved by the app's resolver. */
export const ROUTE_MODEL = "vercel/typesafe-ai/jev";

/** The goal check's seams. An app passes none. */
export interface HostSeams {
  /** The worker files as the host reads them, before anything is built. */
  adaptWorkers?: (workers: WorkerManifest[]) => WorkerManifest[];
  /** Best fit's scripted evaluation, wrapped before the host routes with it. */
  adaptRoute?: (model: EvaluationModel) => EvaluationModel;
  /** The `agent` flow, replaced by one of the app's own built on the installation. */
  agent?: (installation: WorkerInstallation) => { kind: string };
  /** Real models: this resolver resolves the route's model and the delegates' answers. */
  live?: { modelResolver: ModelResolver };
  /** Leave the app's `resolvePrincipal` out, so nothing names its org. */
  omitPrincipal?: boolean;
}

/** The app, booted. */
export interface RoutedHost {
  state: FlowState;
  router: Awaited<ReturnType<FlowState["getRouter"]>>;
  copies: FlowInstance[];
  /** Every call the scripted route evaluation received. Empty on the live leg. */
  routeCalls: MockEvaluationCall[];
}

/** The text of a model message's content. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  return Array.isArray(content) ? content.map((part) => (part as { text?: string }).text ?? "").join("") : "";
}

/** Best fit's scripted evaluation. Reads the `{ recent, post }` state the coordinator hands it. */
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
      throw new Error("the scripted route has no delegate for this post");
    }
  });
}

/** The delegates' scripted answer. Never calls a tool. */
function scriptedAnswer(): MockGeneratorInstance {
  return {
    name: "agent-answer",
    calls: [],
    reset: () => {},
    next: (input: unknown): MockGeneratorScriptStep => {
      const messages = input as Array<{ role: string; content: unknown }>;
      const at = messages.map((m) => m.role).lastIndexOf("user");
      const turn = textOf(messages[at]?.content);
      if (turn.includes("[answer:none]")) return { text: "" };
      const token = /tok-[a-z0-9]+/.exec(turn)?.[0] ?? "";
      if (turn.includes("[answer:from-context]")) {
        // The conversation's lines come as one user-role message just before the post.
        const before = messages[at - 1];
        const lines = before?.role === "user" ? textOf(before.content) : "";
        const item = /item-[a-z0-9]+/.exec(lines)?.[0];
        return { text: `${REPLY_MARKER} ${token} ${item === undefined ? "Buy what?" : `You can buy the ${item} at the shop.`}` };
      }
      return { text: `${REPLY_MARKER} ${token} noted.` };
    }
  };
}

/**
 * Read the team's files, register one copy of each worker flow, the
 * coordinator's among them, and serve them.
 *
 * @param tree The workforce root to read.
 * @param seams The goal check's seams. An app passes nothing.
 */
export async function startRoutedHost(tree: string, seams: HostSeams = {}): Promise<RoutedHost> {
  const read = await readWorkforce(tree);
  if (read.errors.length > 0) {
    throw new Error(`the tree did not load: ${read.errors.map((e) => `${e.path}: ${String(e.error)}`).join(", ")}`);
  }
  const workers = seams.adaptWorkers?.(read.workers) ?? read.workers;

  // The flows are handed to the installation lazily, so each can be built on it.
  let flows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({ standardWorkers: workers, workerFlows: () => flows as never });
  const agent = seams.agent?.(installation) ?? defineAgentWorkerFlow({ installation });
  flows = {
    agent,
    coordinator: defineCoordinatorFlow({ installation, delegateFlows: [agent as never], routeModel: ROUTE_MODEL })
  };
  const copies = hireWorkforce(installation);

  const route = scriptedRoute();
  const state = createFlowState({
    flows: Object.fromEntries(copies.map((copy) => [copy.id, copy])),
    stores: { default: { primary: inMemoryStores() } },
    // Who every request is, and the org its sessions bind to. Ignores the
    // request: one caller, and a body read would be caller-controlled identity.
    ...(seams.omitPrincipal === true ? {} : { resolvePrincipal: () => ({ userId: OWNER, orgId: ORG }) }),
    modelResolver:
      seams.live?.modelResolver ??
      createMockModelResolver({
        generators: { "agent-answer": scriptedAnswer() },
        evaluators: { "coordinator-route": seams.adaptRoute?.(route as EvaluationModel) ?? (route as EvaluationModel) },
        policy: "allow"
      })
  } as never);
  const router = await state.getRouter();
  return { state, router, copies, routeCalls: seams.live === undefined ? route.calls : [] };
}
