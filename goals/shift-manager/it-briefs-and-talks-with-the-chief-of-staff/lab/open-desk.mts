/**
 * The goal's fixture Labs, opened the way Shift Manager's command loads
 * one: a tree with one team, `desk`, whose seats run the turn goal's `asker`
 * kind or the built-in `agent` kind with a real model, in one mailbox with one
 * board. Each kind is one registered copy that every seat naming it runs on,
 * and a seat's sessions name it in their state. The organization's inventory
 * is open, so each seat's row names its door. In-memory stores and no credential, so every start is fresh. The check
 * raises the asks itself, through the Lab's own action route, so the Lab
 * reopens them when they are answered.
 *
 * Two configs open it: `lab/fsdev.config.mts` over the desk with its
 * `chief-of-staff` seat, and `lab-no-cos/fsdev.config.mts` over a desk that
 * declares none.
 *
 * The model is resolved by the framework's resolver from the environment
 * (`AI_GATEWAY_API_KEY` routes `openai/gpt-5.4-mini` through the gateway).
 */
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { createModelResolver, DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
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
import { ASKER_KIND, defineAskerFlow } from "../../it-sends-a-turn-into-a-seat-session/lab/asker/asker.mts";

/** The one person this Lab runs as. */
export const USER_ID = "u_cos_goal";

/**
 * Open the desk Lab over the tree at `root`.
 *
 * @param root The `workforce/` folder to read.
 * @returns The flow state a config default-exports.
 */
export async function openDesk(root: string) {
  const tree = await readDeclaredRoster(root);
  if (tree.problems.length > 0) throw new Error(`the desk tree did not load: ${tree.problems.map((p) => p.error.message).join("; ")}`);

  const { installation, copies } = installWorkers(tree.workers, (installation) => ({ [ASKER_KIND]: defineAskerFlow(installation) }), {
    mailboxBoards: mailboxBoardIds(tree.mailboxes),
  });
  const mailboxKind = defineMailboxFlow({ inventory: true });
  const flows: Record<string, FlowInstance> = {
    ...Object.fromEntries(mailboxInstances(tree.mailboxes, { kinds: { [MAILBOX_KIND]: mailboxKind as never } }).map((i) => [i.kind, i])),
    ...Object.fromEntries(copies.map((copy) => [copy.id, copy])),
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

  return flowState;
}
