/**
 * A fresh app with a coordinator over agents, as a new app would write it.
 *
 * Everything here comes from the published packages and the team's files: no
 * kitchen-sink code, and no dispatcher or router of the app's own. The
 * coordinator is a worker file (`flow: coordinator`, `routing: everyone`),
 * and the app registers Workforce's `coordinator` flow once, with the
 * built-in `agent` as the flow its delegates take posts on. The goal check
 * reads this file's source to hold it to that.
 *
 * The app has one worker flow of its own, `note`, whose workers take notes
 * when asked and declare no delegated-post entry, so a post runs nothing on
 * them. Every other worker runs on the built-in `agent`, answered by a
 * scripted model so the check needs no key. Each flow is registered once; a
 * delegate's conversation is a session on its flow, naming it.
 *
 * `seams` is the goal check's, for its controls, and nothing else. An app
 * passes nothing.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, type FlowState } from "@flow-state-dev/engine";
import { createMockModelResolver, mockGenerator } from "@flow-state-dev/testing";
import {
  createWorkerInstallation,
  defineAgentWorkerFlow,
  defineCoordinatorFlow,
  hireWorkforce,
  workerConfigSchema,
  type WorkerInstallation,
  type WorkerManifest
} from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";

/**
 * `{ message: string }`, built off the contract's own `instructions` string so
 * this host imports nothing outside `@flow-state-dev/*`.
 */
const messageInput = workerConfigSchema().pick({}).extend({ message: workerConfigSchema().shape.instructions.unwrap() });

/** Every worker flow has one door: this fixture's answers by saying what it heard. */
const workerDoor = {
  message: {
    inputSchema: messageInput,
    userMessage: (input: { message: string }) => input.message,
    block: handler({
      name: "fixture-door",
      inputSchema: messageInput,
      execute: (input, ctx) => {
        ctx.emit.message(`Heard: ${input.message}`);
        return {};
      },
    }),
  },
};

/** The user who talks to the coordinator. */
export const OWNER = "u_fresh_host";

/** What an agent delegate answers with, whatever it heard. */
export const REPLY_MARKER = "[reply:fresh-host]";

/**
 * The model best fit's one evaluator call would run on. This app's
 * coordinator routes to everyone and never makes that call, but the flow
 * names no default, so the app names one.
 */
const ROUTE_MODEL = "vercel/typesafe-ai/jev";

/** This app's own worker flow: takes a note when asked directly, and takes no posts. */
const defineNote = (installation: WorkerInstallation) =>
  defineFlow({
    kind: "note",
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources },
    actions: { ...workerDoor, take: { block: handler({ name: "note-take", execute: () => ({}) }) } }
  } as never);

/** The goal check's seams. An app passes none. */
export interface HostSeams {
  /** The worker files as the host reads them, before anything is built. */
  adaptWorkers?: (workers: WorkerManifest[]) => WorkerManifest[];
  /** The flows a delegate takes a post on, given the ones the app names. */
  adaptDelegateFlows?: (flows: { kind: string }[]) => { kind: string }[];
}

/** The app, booted: its router, and what it registered. */
export interface FreshHost {
  state: FlowState;
  router: Awaited<ReturnType<FlowState["getRouter"]>>;
  copies: FlowInstance[];
}

/**
 * Read the team's files, register one copy of each worker flow, the
 * coordinator's among them, and serve them.
 *
 * @param tree The workforce root to read.
 * @param seams The goal check's seams. An app passes nothing.
 */
export async function startFreshHost(tree: string, seams: HostSeams = {}): Promise<FreshHost> {
  const read = await readWorkforce(tree);
  if (read.errors.length > 0) {
    throw new Error(`the tree did not load: ${read.errors.map((e) => `${e.path}: ${String(e.error)}`).join(", ")}`);
  }
  const workers = seams.adaptWorkers?.(read.workers) ?? read.workers;

  // The flows are handed to the installation lazily, so each can be built on it.
  let flows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({ standardWorkers: workers, workerFlows: () => flows as never });
  const agent = defineAgentWorkerFlow({ installation });
  const delegateFlows = seams.adaptDelegateFlows?.([agent]) ?? [agent];
  flows = {
    agent,
    coordinator: defineCoordinatorFlow({ installation, delegateFlows: delegateFlows as never, routeModel: ROUTE_MODEL }),
    note: defineNote(installation)
  };
  const copies = hireWorkforce(installation);

  const state = createFlowState({
    flows: Object.fromEntries(copies.map((copy) => [copy.id, copy])),
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({
      generators: {
        "agent-answer": mockGenerator({
          name: "agent-answer",
          script: [{ when: () => true, then: { text: `${REPLY_MARKER} noted.` } }]
        })
      },
      policy: "allow"
    })
  } as never);
  const router = await state.getRouter();
  return { state, router, copies };
}
