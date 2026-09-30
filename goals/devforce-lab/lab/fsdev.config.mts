/**
 * The DevForce lab as a server: the config `fsdev dev` and App Lab load.
 *
 *     pnpm --filter @flow-state-dev/app-lab start --config goals/devforce-lab/lab/fsdev.config.mts
 *
 * One `FlowState` holding the hired seats and the channel, default-exported,
 * with no app and no route of the lab's own. It is host code only: `host.mts`
 * and the lab's checks are untouched, and this file wires the same tree the
 * same way `openLab` does, with the four things a long-lived server needs
 * that a check does not:
 *
 * - **The inventory, opened at boot.** The organization's seat and channel
 *   collections are what App Lab's TEAMS and PROJECTS read, so the channel kind
 *   is built with the inventory writer and `openInventory` runs before this
 *   module finishes loading, so before the server takes a request.
 * - **Durable execution**, so a seat's ask survives the request that raised it
 *   and a person can answer it later.
 * - **A verified principal.** Like `openLab`, the lab refuses an HTTP read that
 *   presents no bearer, so an org-less request has nothing to fall back to. The
 *   bearer is handed to the page through the `devtool` block, which the host
 *   injects on a loopback bind only.
 * - **One ask waiting.** After the hire, `raiseAsk` (`ask.mts`) puts the EM
 *   seat's approval for {@link ASK_FEATURE} in the EM seat's own session, so
 *   App Lab's Inbox has something to answer. Approve files the row and starts
 *   the coder seat; Deny files nothing.
 *
 * The harness is the lab's scripted stub: no model, and a run that changes
 * nothing in its checkout. A real coding agent goes in the same slot, as
 * `it-commits-from-the-seats-own-file` does.
 *
 * Everything the tree declares is read off it: the channel, its board, which
 * seat is the EM and which seat a row is handed to. No seat, channel or board
 * is named in this file.
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
  channelBoard,
  channelBoardIds,
  channelInstances,
  defineChannelFlow,
  hireWorkforce,
  openChannels,
  openInventory,
  resourcesFromDocs,
  type InventoryActionRequest,
  type OpenChannelsOptions,
} from "@flow-state-dev/workforce";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { RAISE_ASK_STEP, raiseAsk, type AskFeature } from "./ask.mts";
import { ASSIGNEE } from "./board.mts";
import { harnessStub } from "./harness-stub.mts";
import { LAB_ORG_ID, LAB_TREE, LAB_USER_ID } from "./host.mts";
import { createNotifyLog, labNotify } from "./notify.mts";
import { defineImplementPhase } from "./phase.mts";
import { BASE_REF, createScratchRepo } from "./scratch-repo.mts";
import { CODER_KIND, defineCoderWorkerFlow } from "./workforce/flows/workers/coder.mts";
import { EM_KIND, defineEmWorkerFlow } from "./workforce/flows/workers/em.mts";

/**
 * The bearer this server accepts. A local lab's credential, not a secret
 * anything else trusts: it only proves the request came from a page this
 * server handed it to.
 */
const BEARER = "devforce-lab-app";

const verify = createBearerSecretPrincipalResolver({
  secret: BEARER,
  principal: { userId: LAB_USER_ID, orgId: LAB_ORG_ID },
});

/** Fail closed: no bearer, no principal. */
const resolvePrincipal: PrincipalResolver = async (context) => {
  const principal = await verify(context);
  if (principal === null) {
    throw new PrincipalResolutionError(
      "Request requires a verified organization: no verified principal was presented.",
      { status: 401 },
    );
  }
  return principal;
};

/** The feature the EM seat asks a person to approve when the server opens. */
const ASK_FEATURE: AskFeature = {
  issue: "night-mode-toggle",
  goal: "Add a night-mode toggle to the settings page.",
};

const roster = await readDeclaredRoster(LAB_TREE);
if (roster.problems.length > 0) {
  throw new Error(
    `the tree at ${LAB_TREE} did not load cleanly:\n  - ${roster.problems.map((p) => `${p.path}: ${p.error.message}`).join("\n  - ")}`,
  );
}

// The board, read off the tree, as `openLab` reads it: one channel, one board.
const [channel] = roster.channels;
const boardNames = channel?.declared.boards as string[] | undefined;
if (roster.channels.length !== 1 || boardNames?.length !== 1) {
  throw new Error("the DevForce tree declares one channel holding one board; this one does not");
}
const board = channelBoard(channel!.id, boardNames[0]!);
const ledger = { id: board.id, collection: board };

// Which seat is the EM, and which seat a row is handed to: the kind each
// `WORKER.md` names, and the coder seat whose name is the board's assignee.
const kindOf = (id: string) => roster.workers.find((w) => w.id === id)?.declared.flow;
const emSeats = roster.workers.filter((w) => w.declared.flow === EM_KIND).map((w) => w.id);
const coderSeat = roster.workers.find((w) => w.declared.flow === CODER_KIND && w.id.endsWith(`.${ASSIGNEE}`))?.id;
if (emSeats.length === 0 || coderSeat === undefined) {
  throw new Error("the DevForce tree declares no EM seat, or no coder seat the board's rows are handed to");
}

const resources = resourcesFromDocs(roster.documents);
const scratch = createScratchRepo("app-lab");
const stub = harnessStub();

const hired = hireWorkforce(roster.workers, {
  kinds: {
    [EM_KIND]: defineEmWorkerFlow({ coderSeatId: coderSeat, resources, ledger }) as never,
    [CODER_KIND]: defineCoderWorkerFlow({
      ledger,
      harness: stub.slot,
      workspace: { root: scratch.root, sourceRepo: scratch.sourceRepo, baseRef: BASE_REF },
      phase: defineImplementPhase({ requireAcceptance: false }),
      runTimeoutMs: 60_000,
      resources,
    }) as never,
  },
  channelBoards: channelBoardIds(roster.channels),
});

// A post reaches the channel's EM members, as in the lab's product check; the
// other members are declared and never woken.
const members = Array.isArray(channel!.declared.members) ? (channel!.declared.members as string[]) : [];
const channelKind = defineChannelFlow({
  notify: labNotify({
    addresses: Object.fromEntries(members.filter((m) => kindOf(m) === EM_KIND).map((m) => [m, m])),
    log: createNotifyLog(),
  }) as never,
  inventory: true,
});

const flows: Record<string, FlowInstance> = {
  ...Object.fromEntries(
    channelInstances(roster.channels, { kinds: { [CHANNEL_KIND]: channelKind as never } }).map((i) => [i.kind, i]),
  ),
  ...Object.fromEntries(hired.map((seat) => [seat.id, seat])),
};

const flowState = createFlowState({
  flows,
  stores: { default: { primary: inMemoryStores() } },
  durable: true,
  resolvePrincipal,
  devtool: { userId: LAB_USER_ID, bearerToken: BEARER },
} as never);

// Open the channels through the server's own session route, with the bearer,
// so each channel session is bound to the organization the principal names.
const router = (await flowState.getRouter()) as Record<string, (r: Request, c: unknown) => Promise<Response>>;
const call = async (method: "GET" | "POST" | "DELETE", path: string[], body?: unknown) => {
  const response = await router[method]!(
    new Request(`http://devforce-lab.local/api/flows/${path.map(encodeURIComponent).join("/")}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${BEARER}` },
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
await openChannels(roster.channels, { client, userId: LAB_USER_ID });

// Then the inventory, in-process, under the lab's organization.
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
const inventory = await openInventory(
  { seats: hired.map((seat) => ({ id: seat.id, kind: seat.kind })), channels: roster.channels },
  { run, seatWriter: { flowKind: CHANNEL_KIND }, userId: LAB_USER_ID, orgId: LAB_ORG_ID },
);
if (inventory.problems.length > 0) throw new Error(inventory.problems.join("; "));

// The EM seat's ask, last, once everything it runs over is registered: one
// pending approval in the EM seat's own session (`s_<seat id>`), which Inbox
// lists. Raised once per feature per store (`ask.mts`).
if (emSeats.length !== 1) {
  throw new Error(`${RAISE_ASK_STEP}: wanted one "${EM_KIND}" seat to ask from, found ${emSeats.length}`);
}
await raiseAsk({
  state: flowState,
  emSeat: hired.find((seat) => seat.id === emSeats[0])!,
  feature: ASK_FEATURE,
  principal: { userId: LAB_USER_ID, orgId: LAB_ORG_ID },
  ledger,
});

export default flowState;
