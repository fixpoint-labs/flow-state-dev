/**
 * The ask-lab — a small Lab Shift Manager's tests open, whose workers ask a user
 * before they act.
 *
 * Neither goal tree raises an ask on `main` today, so this is the tree the
 * ask paths (Inbox, the shared resume) are proved on. It is an ordinary Lab
 * config: read the tree, build the installation and register one copy of the
 * asker flow and of Workforce's `coordinator` flow, open the user's
 * conversations with the two coordinators (`ops.desk` and `ops.side`, each
 * under its worker's id), then the inventory, written from a small flow of the
 * Lab's own that carries the inventory writer. In-memory stores, so every load
 * is a fresh Lab.
 *
 * A post to a coordinator conversation reaches each of its delegates, which
 * asks a user in a session the delivery opened: a dispatch run. Nothing
 * files a task, so each conversation's board is empty.
 *
 * `fsdev.config.mts` beside this file is the config the `shift-manager` command
 * loads; tests call {@link openAskLab} directly for the handle and the tree.
 */
import {
  createBearerSecretPrincipalResolver,
  createFlowState,
  inMemoryStores,
  PrincipalResolutionError,
  runAction,
  type PrincipalResolver,
} from "@flow-state-dev/engine";
import type { FlowInstance } from "@flow-state-dev/core/types";
import {
  COORDINATOR_FLOW,
  createWorkerInstallation,
  defineCoordinatorFlow,
  hireWorkforce,
  inventoryWorkers,
  inventoryWriterActions,
  resourcesFromDocs,
  defineProjectBlocks,
  openInventory,
  type CreateProjectInput,
  type InventoryActionRequest,
} from "@flow-state-dev/workforce";
import { readDeclaredRoster, type DeclaredRoster } from "@flow-state-dev/workforce/loader";
import { DEFAULT_ORG_ID, defineFlow } from "@flow-state-dev/core";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ASKER_FLOW, defineAskerFlow } from "./asker.mts";

/** The tree this Lab reads. */
export const ASK_LAB_TREE = join(dirname(fileURLToPath(import.meta.url)), "workforce");

/** One more worker, `ops.shift-coordinator`, that {@link AskLabOptions.shiftCoordinator} adds to the tree. */
const SHIFT_COORDINATOR_TREE = join(dirname(fileURLToPath(import.meta.url)), "with-shift-coordinator");

/** The one user this Lab runs as. */
export const ASK_LAB_USER_ID = "u_ask_lab";

/** Read the tree, refusing it whole if anything did not load. */
export async function readAskLabTree(root: string = ASK_LAB_TREE): Promise<DeclaredRoster> {
  const roster = await readDeclaredRoster(root);
  if (roster.problems.length > 0) {
    throw new Error(`the ask-lab tree did not load: ${roster.problems.map((p) => p.error.message).join("; ")}`);
  }
  return roster;
}

/** The organization a bearer-gated ask-lab binds its user to. */
export const ASK_LAB_ORG_ID = "org_ask_lab";

/**
 * A fail-closed resolver: the bearer's principal, or a 401 when none was
 * presented. The shape a Lab with verified identity has (the DevTeam profile's).
 */
function bearerOnly(secret: string, orgId: string): PrincipalResolver {
  const verify = createBearerSecretPrincipalResolver({
    secret,
    principal: { userId: ASK_LAB_USER_ID, orgId },
  });
  return async (context) => {
    const principal = await verify(context);
    if (principal === null) {
      throw new PrincipalResolutionError("Request requires a verified organization: no verified principal was presented.", {
        status: 401,
      });
    }
    return principal;
  };
}

/** The coordinators whose conversations the Lab opens for its user at boot, each under the worker's own id. */
export const ASK_LAB_COORDINATORS = ["ops.desk", "ops.side"] as const;

/**
 * The model best fit's one evaluator call would run on. Both coordinators
 * route to everyone and never make that call, but the flow names no default.
 */
const ROUTE_MODEL = "vercel:openai/gpt-5.4-mini";

/** The flow the inventory is written from: the Lab's own, carrying the writer. */
const INVENTORY_WRITER_FLOW = "inventory-writer";

/** How to open the ask-lab. */
export type AskLabOptions = {
  /**
   * Open the user's coordinator conversations at boot. Default true.
   * `false` opens nothing, so the user holds no session: a Lab with nothing
   * to say which organization they are in. The inventory, whose writes run in
   * a session of the user's, stays shut too.
   */
  conversations?: boolean;
  /** Open the inventory at boot. Default true. */
  inventory?: boolean;
  /**
   * Register each worker with its actions, so its inventory row names its door.
   * Default true. `false` registers id and worker flow only: every worker reads as a
   * worker flow with no door.
   */
  doors?: boolean;
  /**
   * Declare the inventory's collections: the writer's flow, and the asker
   * worker flow for a browser to read. Default true. `false` is a Lab whose flows
   * never declare an inventory, so no session it serves lists one. The
   * inventory is not opened either.
   */
  inventoryDeclared?: boolean;
  /**
   * Require this bearer secret on every HTTP read, and bind the user to
   * {@link ASK_LAB_ORG_ID}. Absent: the development organization, no credential.
   */
  bearer?: string;
  /**
   * With `bearer`, the organization the user is bound to instead of
   * {@link ASK_LAB_ORG_ID}. `"ops"` names the organization like the Lab's
   * declared team, so a declared worker's id reads as an address in it.
   */
  orgId?: string;
  /** Add a worker named `shift-coordinator` to the ops team, on the asker worker flow. Default false. */
  shiftCoordinator?: boolean;
  /** Let the asker worker flow's `message` door start projects (`startProjectLine`). Default false. */
  workersStartProjects?: boolean;
  /**
   * Projects to create once the inventory is open, each as `owner` (default
   * the Lab's user) through the project writes' own `createProject`.
   */
  projects?: Array<CreateProjectInput & { owner?: string }>;
};

/** The flow the ask-lab creates projects through. */
const PROJECTS_FLOW = "projects";

/** Build, open and hand back the Lab. */
export async function openAskLab(options: AskLabOptions = {}) {
  const orgId = options.bearer === undefined ? DEFAULT_ORG_ID : (options.orgId ?? ASK_LAB_ORG_ID);
  const tree = await readAskLabTree();
  if (options.shiftCoordinator === true) tree.workers.push(...(await readAskLabTree(SHIFT_COORDINATOR_TREE)).workers);
  const declared = options.inventoryDeclared !== false;
  let workerFlows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({ standardWorkers: tree.workers, workerFlows: () => workerFlows as never });
  const asker = defineAskerFlow(installation, resourcesFromDocs(tree.documents), {
    projects: options.workersStartProjects,
    inventory: declared,
  });
  workerFlows = {
    [ASKER_FLOW]: { flow: asker, roles: ["contributor"] },
    [COORDINATOR_FLOW]: defineCoordinatorFlow({ installation, routeModel: ROUTE_MODEL }),
  };
  const copies = hireWorkforce(installation);
  const flows: Record<string, FlowInstance> = {
    ...Object.fromEntries(copies.map((copy) => [copy.id, copy])),
    // The worker write takes caller-supplied rows, so it is internal only.
    ...(declared
      ? {
          [INVENTORY_WRITER_FLOW]: defineFlow({
            kind: INVENTORY_WRITER_FLOW,
            internal: { actions: { ...inventoryWriterActions() } },
          } as never)(),
        }
      : {}),
    ...(options.projects === undefined
      ? {}
      : {
          [PROJECTS_FLOW]: defineFlow({ kind: PROJECTS_FLOW, actions: defineProjectBlocks().actions } as never)(),
        }),
  };
  const primary = inMemoryStores();
  const flowState = createFlowState({
    flows,
    stores: { default: { primary } },
    durable: true,
    devtool: { userId: ASK_LAB_USER_ID, ...(options.bearer === undefined ? {} : { bearerToken: options.bearer }) },
    ...(options.bearer === undefined ? {} : { resolvePrincipal: bearerOnly(options.bearer, orgId) }),
  } as never);

  const router = (await flowState.getRouter()) as Record<string, (r: Request, c: unknown) => Promise<Response>>;
  const call = async (method: "GET" | "POST" | "DELETE", path: string[], body?: unknown) => {
    const response = await router[method]!(
      new Request(`http://ask-lab.local/api/flows/${path.map(encodeURIComponent).join("/")}`, {
        method,
        headers: {
          "content-type": "application/json",
          ...(options.bearer === undefined ? {} : { authorization: `Bearer ${options.bearer}` }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      { params: { path } },
    );
    const text = await response.text();
    return { status: response.status, body: text.length > 0 ? JSON.parse(text) : null };
  };
  if (options.conversations === false) return { flowState, tree, flows };
  for (const workerId of ASK_LAB_COORDINATORS) {
    const { status, body } = await call("POST", [COORDINATOR_FLOW, "sessions"], {
      userId: ASK_LAB_USER_ID,
      sessionId: workerId,
      state: { workerId },
    });
    if (status >= 400) throw new Error(`open the ${workerId} conversation: ${status} ${JSON.stringify(body)}`);
  }

  if (declared && options.inventory !== false) {
    const runtime = await flowState.getRuntime();
    const run = async (request: InventoryActionRequest): Promise<unknown> => {
      const flow = flows[request.flowKind];
      if (flow === undefined) throw new Error(`no flow "${request.flowKind}"`);
      const result = (await runAction({
        flow,
        actionName: request.action,
        input: request.input,
        userId: request.userId,
        orgId: request.orgId,
        sessionId: request.sessionId,
        source: request.source,
        stores: runtime.stores,
        runtimeConfig: runtime.runtimeConfig,
      } as never)) as { error?: unknown };
      if (result?.error !== undefined) throw new Error(String((result.error as Error).message ?? result.error));
      return result;
    };
    const binding = await openInventory(
      {
        workers: options.doors === false
          ? inventoryWorkers(installation).map((worker) => ({ ...worker, actions: {} }))
          : inventoryWorkers(installation),
      },
      { run, workerWriter: { flowKind: INVENTORY_WRITER_FLOW }, userId: ASK_LAB_USER_ID, orgId },
    );
    if (binding.problems.length > 0) throw new Error(binding.problems.join("; "));

    for (const { owner = ASK_LAB_USER_ID, ...input } of options.projects ?? []) {
      const result = (await runAction({
        flow: flows[PROJECTS_FLOW],
        actionName: "createProject",
        input,
        userId: owner,
        orgId,
        sessionId: `projects-${owner}`,
        stores: runtime.stores,
        runtimeConfig: runtime.runtimeConfig,
      } as never)) as { error?: unknown };
      if (result.error !== undefined) throw new Error(`project ${input.id}: ${String((result.error as Error).message ?? result.error)}`);
    }
  }

  return { flowState, tree, flows };
}
