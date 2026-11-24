/**
 * A converted desk, served the way a new app would serve it.
 *
 * Everything here comes from the published packages and the team's files: the
 * coordinator is a worker file (`flow: coordinator`) and its delegates are
 * agent workers (no `flow:` line). The app installs the workforce kit over the
 * tree, which serves its built-in `agent` flow and, configured, the
 * `coordinator` flow once each, over SQLite stores on the file the caller
 * names. Agent answers come from a scripted model, so the check needs no key.
 * The app names its one user and org in `resolvePrincipal`.
 */
import { createFlowState, type FlowState } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { createMockModelResolver, mockGenerator } from "@flow-state-dev/testing";
import { workforce } from "@flow-state-dev/workforce/kit";

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
 * Install the workforce kit over the team's files, which serves one copy of
 * each worker flow, and serve them over SQLite.
 *
 * @param tree The workforce root the kit reads.
 * @param dbFile The SQLite file the app writes. A fresh path per run.
 * @throws As the app's start does, on a file the kit refuses.
 */
export async function startConvertedDesk(tree: string, dbFile: string): Promise<ConvertedDesk> {
  const state = createFlowState({
    kits: [workforce({ directory: tree, coordinator: { routeModel: ROUTE_MODEL } })],
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
