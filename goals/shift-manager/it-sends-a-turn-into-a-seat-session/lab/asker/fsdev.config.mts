/**
 * The goal's fixture Lab, as Shift Manager's command loads it: one seat that
 * asks and hears (`asker.mts`), in one mailbox, with the organization's
 * inventory open so the seat's row names its door. In-memory stores and no
 * credential, so every start is fresh. The check raises the ask itself,
 * through the Lab's own action route.
 */
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { FlowInstance } from "@flow-state-dev/core/types";
import {
  MAILBOX_KIND,
  mailboxBoardIds,
  mailboxInstances,
  defineMailboxFlow,
  hireWorkforce,
  openMailboxes,
  openInventory,
  type InventoryActionRequest,
  type OpenMailboxesOptions,
} from "@flow-state-dev/workforce";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { fileURLToPath } from "node:url";
import { ASKER_KIND, defineAskerFlow } from "./asker.mts";

/** The one person this Lab runs as. */
const USER_ID = "u_turn_goal";

const tree = await readDeclaredRoster(fileURLToPath(new URL("./workforce", import.meta.url)));
if (tree.problems.length > 0) throw new Error(`the asker tree did not load: ${tree.problems.map((p) => p.error.message).join("; ")}`);

const seats = hireWorkforce(tree.workers, {
  workerFlows: { [ASKER_KIND]: defineAskerFlow() as never },
  mailboxBoards: mailboxBoardIds(tree.mailboxes),
});
const mailboxKind = defineMailboxFlow({ inventory: true });
const flows: Record<string, FlowInstance> = {
  ...Object.fromEntries(mailboxInstances(tree.mailboxes, { kinds: { [MAILBOX_KIND]: mailboxKind as never } }).map((i) => [i.kind, i])),
  ...Object.fromEntries(seats.map((seat) => [seat.id, seat])),
};
const flowState = createFlowState({
  flows,
  stores: { default: { primary: inMemoryStores() } },
  durable: true,
  devtool: { userId: USER_ID },
} as never);

const router = (await flowState.getRouter()) as Record<string, (r: Request, c: unknown) => Promise<Response>>;
const call = async (method: "GET" | "POST" | "DELETE", path: string[], body?: unknown) => {
  const response = await router[method]!(
    new Request(`http://turn-goal.local/api/flows/${path.map(encodeURIComponent).join("/")}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { params: { path } },
  );
  const text = await response.text();
  return { status: response.status, body: text.length > 0 ? JSON.parse(text) : null };
};
const client: OpenMailboxesOptions["client"] = {
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
await openMailboxes(tree.mailboxes, { client, userId: USER_ID });

const runtime = await flowState.getRuntime();
const opened = await openInventory(
  { seats, mailboxes: tree.mailboxes },
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
    seatWriter: { flowKind: MAILBOX_KIND },
    userId: USER_ID,
    orgId: DEFAULT_ORG_ID,
  },
);
if (opened.problems.length > 0) throw new Error(opened.problems.join("; "));

export default flowState;
