/**
 * The ask-lab — a small Lab Shift Manager's tests open, whose seats ask a person
 * before they act.
 *
 * Neither goal tree raises an ask on `main` today, so this is the tree the
 * ask paths (Inbox, a workstream Stream's asks, the shared resume) are proved
 * on. It is an ordinary Lab config: read the tree, hire, build the channel
 * kind with the framework's own member wake and the inventory writer, open the
 * channels and then the inventory, default-export the `FlowState`. In-memory
 * stores, so every load is a fresh Lab.
 *
 * `fsdev.config.mts` beside this file is the config Shift Manager's start script
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
  CHANNEL_KIND,
  channelBoardIds,
  channelInstances,
  defineChannelFlow,
  hireWorkforce,
  resourcesFromDocs,
  defineProjectBlocks,
  openChannels,
  openInventory,
  wakeMemberSeats,
  type CreateProjectInput,
  type InventoryActionRequest,
  type OpenChannelsOptions,
} from "@flow-state-dev/workforce";
import { readDeclaredRoster, type DeclaredRoster } from "@flow-state-dev/workforce/loader";
import { DEFAULT_ORG_ID, defineFlow } from "@flow-state-dev/core";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ASKER_KIND, defineAskerFlow } from "./asker.mts";

/** The tree this Lab reads. */
export const ASK_LAB_TREE = join(dirname(fileURLToPath(import.meta.url)), "workforce");

/** One more worker, `ops.chief-of-staff`, that {@link AskLabOptions.chiefOfStaff} adds to the tree. */
const CHIEF_OF_STAFF_TREE = join(dirname(fileURLToPath(import.meta.url)), "with-chief-of-staff");

/** The one person this Lab runs as. */
export const ASK_LAB_USER_ID = "u_ask_lab";

/** Read the tree, refusing it whole if anything did not load. */
export async function readAskLabTree(root: string = ASK_LAB_TREE): Promise<DeclaredRoster> {
  const roster = await readDeclaredRoster(root);
  if (roster.problems.length > 0) {
    throw new Error(`the ask-lab tree did not load: ${roster.problems.map((p) => p.error.message).join("; ")}`);
  }
  return roster;
}

/** The organization a bearer-gated ask-lab binds its person to. */
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

/** How to open the ask-lab. */
export type AskLabOptions = {
  /**
   * Open the channels at boot. Default true. `false` opens nothing, so the
   * person holds no session: a Lab with nothing to say which organization
   * they are in. The inventory, which needs the channels, stays shut too.
   */
  channels?: boolean;
  /** Open the inventory at boot. Default true. */
  inventory?: boolean;
  /**
   * Register each seat with its actions, so its inventory row names its door.
   * Default true. `false` registers id and kind only: every seat reads as a
   * kind with no door.
   */
  doors?: boolean;
  /**
   * Build the channel kind with the inventory's collections. Default true.
   * `false` is a Lab whose flows never declare an inventory, so no session it
   * serves lists one. The inventory is not opened either.
   */
  inventoryDeclared?: boolean;
  /**
   * Require this bearer secret on every HTTP read, and bind the person to
   * {@link ASK_LAB_ORG_ID}. Absent: the development organization, no credential.
   */
  bearer?: string;
  /**
   * With `bearer`, the organization the person is bound to instead of
   * {@link ASK_LAB_ORG_ID}. `"ops"` names the organization like the Lab's
   * declared team, so a declared seat's id reads as an address in it.
   */
  orgId?: string;
  /** Add a seat named `chief-of-staff` to the ops team, on the asker kind. Default false. */
  chiefOfStaff?: boolean;
  /**
   * Projects to create once the inventory is open, each as `owner` (default
   * the Lab's person) through the project writes' own `createProject`.
   * `unbound` creates it with a talk kind no flow serves, so its owner's talk
   * session is never minted: the row a failed mint leaves behind.
   */
  projects?: Array<CreateProjectInput & { owner?: string; unbound?: boolean }>;
};

/** The flow kinds the ask-lab creates projects through: one that binds the owner, one whose bind can't land. */
const PROJECTS_KIND = "projects";
const UNBOUND_PROJECTS_KIND = "projects-unbound";

/** Build, open and hand back the Lab. */
export async function openAskLab(options: AskLabOptions = {}) {
  const orgId = options.bearer === undefined ? DEFAULT_ORG_ID : (options.orgId ?? ASK_LAB_ORG_ID);
  const tree = await readAskLabTree();
  if (options.chiefOfStaff === true) tree.workers.push(...(await readAskLabTree(CHIEF_OF_STAFF_TREE)).workers);
  const seats = hireWorkforce(tree.workers, {
    kinds: { [ASKER_KIND]: defineAskerFlow(resourcesFromDocs(tree.documents)) as never },
    channelBoards: channelBoardIds(tree.channels),
  });
  const declared = options.inventoryDeclared !== false;
  const channelKind = defineChannelFlow({ notify: wakeMemberSeats(seats), inventory: declared });
  const flows: Record<string, FlowInstance> = {
    ...Object.fromEntries(
      channelInstances(tree.channels, { kinds: { [CHANNEL_KIND]: channelKind as never } }).map((i) => [i.kind, i]),
    ),
    ...Object.fromEntries(seats.map((seat) => [seat.id, seat])),
    ...(options.projects === undefined
      ? {}
      : {
          [PROJECTS_KIND]: defineFlow({ kind: PROJECTS_KIND, actions: defineProjectBlocks().actions } as never)(),
          [UNBOUND_PROJECTS_KIND]: defineFlow({
            kind: UNBOUND_PROJECTS_KIND,
            actions: defineProjectBlocks({ talkKind: "no-such-talk-kind" }).actions,
          } as never)(),
        }),
  };
  const flowState = createFlowState({
    flows,
    stores: { default: { primary: inMemoryStores() } },
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
  const client: OpenChannelsOptions["client"] = {
    createSession: async (create) => {
      const { status, body } = await call("POST", [create.flowKind, "sessions"], create);
      if (status >= 400) throw Object.assign(new Error(`create session: ${status}`), { status });
      return body;
    },
    getSession: async (sessionId) => {
      const { status, body } = await call("GET", ["sessions", sessionId]);
      if (status >= 400) throw new Error(`read session ${sessionId}: ${status}`);
      return body?.session ?? body;
    },
    deleteSession: async (sessionId) => {
      await call("DELETE", ["sessions", sessionId]);
    },
  };
  if (options.channels === false) return { flowState, tree, flows };
  await openChannels(tree.channels, { client, userId: ASK_LAB_USER_ID });

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
        seats: options.doors === false ? seats.map((seat) => ({ id: seat.id, kind: seat.kind, actions: {} })) : seats,
        channels: tree.channels,
      },
      { run, seatWriter: { flowKind: CHANNEL_KIND }, userId: ASK_LAB_USER_ID, orgId },
    );
    if (binding.problems.length > 0) throw new Error(binding.problems.join("; "));

    for (const { owner = ASK_LAB_USER_ID, unbound, ...input } of options.projects ?? []) {
      const kind = unbound === true ? UNBOUND_PROJECTS_KIND : PROJECTS_KIND;
      const result = (await runAction({
        flow: flows[kind],
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
