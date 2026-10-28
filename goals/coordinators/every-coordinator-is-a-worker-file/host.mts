/**
 * A converted desk, served the way a new app would serve it.
 *
 * Everything here comes from the published packages and the team's files: the
 * coordinator is a worker file (`flow: coordinator`) and its delegates are
 * agent workers (no `flow:` line). The app registers the built-in `agent`
 * flow and Workforce's `coordinator` flow once each, with `agent` as the flow
 * its delegates take posts on, over SQLite stores on the file the caller
 * names. Agent answers come from a scripted model, so the check needs no key.
 * The app names its one user and org in `resolvePrincipal`.
 */
import { createFlowState, type FlowState } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { createMockModelResolver, mockGenerator } from "@flow-state-dev/testing";
import {
  createWorkerInstallation,
  defineAgentWorkerFlow,
  defineCoordinatorFlow,
  hireWorkforce
} from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";

/** The user who talks to the coordinator. */
export const OWNER = "u_converted_desk";

/** The organization the app runs as. */
export const ORG = "org_converted_desk";

/** What an agent delegate answers with, whatever it heard. */
export const REPLY_MARKER = "[reply:converted-desk]";

/**
 * The model best fit's evaluator call would run on. This desk routes to
 * everyone and never makes that call, but the flow names no default.
 */
const ROUTE_MODEL = "vercel:typesafe-ai/jev";

/** The app, booted: its router and its runtime. */
export interface ConvertedDesk {
  state: FlowState;
  router: Awaited<ReturnType<FlowState["getRouter"]>>;
}

/**
 * Read the team's files, register one copy of each worker flow, and serve
 * them over SQLite.
 *
 * @param tree The workforce root to read.
 * @param dbFile The SQLite file the app writes. A fresh path per run.
 */
export async function startConvertedDesk(tree: string, dbFile: string): Promise<ConvertedDesk> {
  const read = await readWorkforce(tree);
  if (read.errors.length > 0) {
    throw new Error(`the tree did not load: ${read.errors.map((e) => `${e.path}: ${String(e.error)}`).join(", ")}`);
  }

  // The flows are handed to the installation lazily, so each can be built on it.
  let flows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({ standardWorkers: read.workers, workerFlows: () => flows as never });
  const agent = defineAgentWorkerFlow({ installation });
  flows = {
    agent,
    coordinator: defineCoordinatorFlow({ installation, routeModel: ROUTE_MODEL })
  };
  const copies = hireWorkforce(installation);

  const state = createFlowState({
    flows: Object.fromEntries(copies.map((copy) => [copy.id, copy])),
    stores: { default: { primary: sqliteStores({ filename: dbFile }) } },
    // One caller; never read from the request.
    resolvePrincipal: () => ({ userId: OWNER, orgId: ORG }),
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
  return { state, router };
}
