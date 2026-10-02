/**
 * The look check's desk Lab, as Shift Manager's start script loads it: one
 * team, `desk`, with a seat named `chief-of-staff` on the built-in `agent`
 * kind, in one channel with one board, and the organization's inventory open
 * so the seat's row names its door. In-memory stores and no credential, so
 * every start is fresh.
 *
 * No model key: the seat's model is `@flow-state-dev/testing`'s mock resolver
 * with one scripted reply, read from the check's fixture. The check sends one
 * line through the seat's door and reads the screen once the reply is stored;
 * a second generator call has no script and fails rather than inventing one.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createMockModelResolver, mockGenerator } from "@flow-state-dev/testing";
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

/** The one person this Lab runs as. */
export const USER_ID = "u_look_goal";

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL("../fixtures/input.json", import.meta.url)), "utf8")) as {
  desk: { reply: string };
};

const tree = await readDeclaredRoster(fileURLToPath(new URL("./workforce", import.meta.url)));
if (tree.problems.length > 0) throw new Error(`the desk tree did not load: ${tree.problems.map((p) => p.error.message).join("; ")}`);
// The seat's model, as its WORKER.md names it: the one id the mock answers for.
const modelId = tree.workers.map((w) => w.declared.model).find((m): m is string => typeof m === "string");
if (modelId === undefined) throw new Error("the desk tree's chief of staff names no model");

const seats = hireWorkforce(tree.workers, { channelBoards: channelBoardIds(tree.channels) });
const channelKind = defineChannelFlow({ inventory: true });
const flows: Record<string, FlowInstance> = {
  ...Object.fromEntries(channelInstances(tree.channels, { kinds: { [CHANNEL_KIND]: channelKind as never } }).map((i) => [i.kind, i])),
  ...Object.fromEntries(seats.map((seat) => [seat.id, seat])),
};
const flowState = createFlowState({
  flows,
  stores: { default: { primary: inMemoryStores() } },
  durable: true,
  modelResolver: createMockModelResolver({
    models: { [modelId]: mockGenerator({ name: "chief-of-staff", script: [{ text: fixture.desk.reply }] }) },
  }),
  devtool: { userId: USER_ID },
} as never);

const router = (await flowState.getRouter()) as Record<string, (r: Request, c: unknown) => Promise<Response>>;
const call = async (method: "GET" | "POST" | "DELETE", path: string[], body?: unknown) => {
  const response = await router[method]!(
    new Request(`http://look-goal.local/api/flows/${path.map(encodeURIComponent).join("/")}`, {
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
