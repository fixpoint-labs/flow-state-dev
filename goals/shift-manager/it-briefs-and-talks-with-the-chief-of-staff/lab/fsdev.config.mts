/**
 * The goal's fixture Lab, as Shift Manager's start script loads it: one team,
 * `desk`, with a seat that asks a person (the turn goal's `asker` kind) and a
 * seat named `chief-of-staff` on the built-in `agent` kind with a real model,
 * in one channel with one board. The organization's inventory is open, so each
 * seat's row names its door. In-memory stores and no credential, so every
 * start is fresh. The check raises the asks itself, through the Lab's own
 * action route, so the Lab reopens them when they are answered.
 *
 * The model is resolved by the framework's resolver from the environment
 * (`AI_GATEWAY_API_KEY` routes `openai/gpt-5.4-mini` through the gateway).
 */
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { createModelResolver, DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import {
  CHANNEL_KIND,
  channelBoardIds,
  channelInstances,
  defineChannelFlow,
  hireWorkforce,
  openChannels,
  openInventory,
  type InventoryActionRequest,
  type OpenChannelsOptions,
} from "@flow-state-dev/workforce";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { fileURLToPath } from "node:url";
import { ASKER_KIND, defineAskerFlow } from "../../it-sends-a-turn-into-a-seat-session/lab/asker/asker.mts";

/** The one person this Lab runs as. */
export const USER_ID = "u_cos_goal";

const tree = await readDeclaredRoster(fileURLToPath(new URL("./workforce", import.meta.url)));
if (tree.problems.length > 0) throw new Error(`the desk tree did not load: ${tree.problems.map((p) => p.error.message).join("; ")}`);

const seats = hireWorkforce(tree.workers, {
  kinds: { [ASKER_KIND]: defineAskerFlow() as never },
  channelBoards: channelBoardIds(tree.channels),
});
const channelKind = defineChannelFlow({ inventory: true });
const flows: Record<string, FlowInstance> = {
  ...Object.fromEntries(channelInstances(tree.channels, { kinds: { [CHANNEL_KIND]: channelKind as never } }).map((i) => [i.kind, i])),
  ...Object.fromEntries(seats.map((seat) => [seat.id, seat])),
};
const flowState = createFlowState({
  flows,
  stores: { default: { primary: inMemoryStores() } },
  durable: true,
  modelResolver: createModelResolver(),
  devtool: { userId: USER_ID },
} as never);

const router = (await flowState.getRouter()) as Record<string, (r: Request, c: unknown) => Promise<Response>>;
const call = async (method: "GET" | "POST" | "DELETE", path: string[], body?: unknown) => {
  const response = await router[method]!(
    new Request(`http://cos-goal.local/api/flows/${path.map(encodeURIComponent).join("/")}`, {
      method,
      headers: { "content-type": "application/json" },
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
await openChannels(tree.channels, { client, userId: USER_ID });

const runtime = await flowState.getRuntime();
const opened = await openInventory(
  { seats, channels: tree.channels },
  {
    run: async (request: InventoryActionRequest) => {
      const result = (await runAction({
        flow: flows[request.flowKind],
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
    },
    seatWriter: { flowKind: CHANNEL_KIND },
    userId: USER_ID,
    orgId: DEFAULT_ORG_ID,
  },
);
if (opened.problems.length > 0) throw new Error(opened.problems.join("; "));

export default flowState;
