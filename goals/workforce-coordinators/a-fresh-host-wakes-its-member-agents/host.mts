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
 * delegate's conversation is a session on its flow, naming it. The app names
 * its one user and org in `resolvePrincipal`, so every session it makes, the
 * delegates' included, carries that org rather than the development default.
 *
 * `seams` is the goal check's, for its controls, and nothing else. An app
 * passes nothing.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, type FlowState } from "@flow-state-dev/engine";
import { createMockModelResolver, mockGenerator } from "@flow-state-dev/testing";
import {
  defineAgentWorkerFlow,
  defineCoordinatorFlow,
  messageReceivedEntry,
  workerConfigSchema,
  workerMessagesResources,
  workerFlow,
  type WorkerInstallation,
  type WorkerRole,
} from "@flow-state-dev/workforce";
import { workforce } from "@flow-state-dev/workforce/kit";

/**
 * `{ message: string }`, built off the contract's own `instructions` string so
 * this host imports nothing outside `@flow-state-dev/*`.
 */
const messageInput = workerConfigSchema().pick({}).extend({ message: workerConfigSchema().shape.instructions.unwrap() });

/** Every worker flow has one door: this fixture's answers by saying what it heard. */
const workerDoor = {
  respond: {
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

/** The organization the app runs as. Every session it makes carries it. */
export const ORG = "org_fresh_host";

/** What an agent delegate answers with, whatever it heard. */
export const REPLY_MARKER = "[reply:fresh-host]";

/**
 * The model best fit's one evaluator call would run on. This app's
 * coordinator routes to everyone and never makes that call, but the flow
 * names no default, so the app names one.
 */
const ROUTE_MODEL = "vercel:typesafe-ai/jev";

/** This app's own worker flow: takes a note when asked directly, and takes no posts. */
const defineNote = (installation: WorkerInstallation) =>
  defineFlow({
    kind: "note",
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources, ...workerMessagesResources },
    actions: { ...workerDoor, take: { block: handler({ name: "note-take", execute: () => ({}) }) } },
    internal: { actions: { onMessageReceived: messageReceivedEntry({ installation, flowKind: "note" }) } }
  } as never);

/** The goal check's seams. An app passes none. */
export interface HostSeams {
  /** The `agent` flow the app registers, given the one it builds. */
  adaptAgentFlow?: <T extends object>(agent: T) => T;
  /** The roles the `agent` flow is registered with, in place of its own. */
  agentRoles?: readonly WorkerRole[];
  /** Leave the app's `resolvePrincipal` out, so nothing names its org. */
  omitPrincipal?: boolean;
}

/** The app, booted: its router, and what it registered. */
export interface FreshHost {
  state: FlowState;
  router: Awaited<ReturnType<FlowState["getRouter"]>>;
  copies: FlowInstance[];
}

/**
 * Install the workforce kit over the team's files, with one copy of each
 * worker flow, the coordinator's among them, and serve them.
 *
 * @param tree The workforce root to read.
 * @param seams The goal check's seams. An app passes nothing.
 */
export async function startFreshHost(tree: string, seams: HostSeams = {}): Promise<FreshHost> {
  // Each flow is built on the installation the workforce kit hires.
  const workerFlows = {
    agent: workerFlow(
      (installation) => {
        const built = defineAgentWorkerFlow({ installation });
        return seams.adaptAgentFlow?.(built) ?? built;
      },
      seams.agentRoles === undefined ? {} : { roles: seams.agentRoles }
    ),
    coordinator: workerFlow((installation) => defineCoordinatorFlow({ installation, routeModel: ROUTE_MODEL })),
    note: workerFlow(defineNote)
  };

  const state = createFlowState({
    kits: [workforce({ directory: tree })],
    fill: { [workforce.slots.workerFlows]: workerFlows },
    stores: { default: { primary: inMemoryStores() } },
    // Who every request is, and the org its sessions bind to. Ignores the
    // request: one caller, and a body read would be caller-controlled identity.
    ...(seams.omitPrincipal === true ? {} : { resolvePrincipal: () => ({ userId: OWNER, orgId: ORG }) }),
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
  const copies = (await state.getRuntime()).registry.list();
  return { state, router, copies };
}
