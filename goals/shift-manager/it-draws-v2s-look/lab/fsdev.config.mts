/**
 * The look check's desk Lab, as Shift Manager's command loads it: one
 * team, `desk`, whose one worker, `chief-of-staff`, runs on the one copy of
 * the built-in `agent` flow the installation registers (its WORKER.md names
 * `flow: agent`), with no flow of its own: its sessions are on that copy and
 * name it in their state. One mailbox with one board, and the organization's
 * inventory open so the seat's row names its door. In-memory stores and no
 * credential, so every start is fresh.
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
  MAILBOX_KIND,
  mailboxBoardIds,
  mailboxInstances,
  defineMailboxFlow,
  inventorySeats,
  openMailboxes,
  openInventory,
  type InventoryActionRequest,
  type OpenMailboxesOptions,
} from "@flow-state-dev/workforce";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { installWorkers } from "../../../lib/workers.mts";

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

const { installation, copies } = installWorkers(tree.workers, () => ({}), { mailboxBoards: mailboxBoardIds(tree.mailboxes) });
const mailboxKind = defineMailboxFlow({ inventory: true });
const flows: Record<string, FlowInstance> = {
  ...Object.fromEntries(mailboxInstances(tree.mailboxes, { kinds: { [MAILBOX_KIND]: mailboxKind as never } }).map((i) => [i.kind, i])),
  ...Object.fromEntries(copies.map((copy) => [copy.id, copy])),
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
  { seats: inventorySeats(installation), mailboxes: tree.mailboxes },
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
