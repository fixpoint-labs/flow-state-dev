/**
 * Leg `nc` (FIX-2774 Open, the recommended answer): a worker's run started with no
 * conversation, by the server (`runAction`, `source: "system"`, in a one-off session), stops for an
 * approval. The Inbox lists the ask once, from no named worker, with its reply box blocked,
 * and answering it there resumes the run.
 *
 * Model-free, on a host of its own in this process: one `serve()` host over a SQLite file
 * (a stop needs durable execution), the workforce kit, and a flow, `nc-asker`, whose door stops
 * for an approval, named in the org's inventory as the flow of the worker `ops.asker`.
 * Shift Manager's own Inbox screen is drawn headless (react-dom over a happy-dom document)
 * under its own provider, on the item's route, and the approval is given by its Approve
 * button. Graded on the page and on the request's status in the store.
 *
 *   nc:listed            the Inbox lists the ask once, as the only item, attributed to no worker
 *   nc:no-reply          the item's reply box is blocked, saying there is no conversation to reply into
 *   nc:answer-resumes    Approve answers it, and the run goes on to complete
 *
 * Its control, `GOAL_CONTROL=session-only`, drops every ask with no conversation in the view: it
 * must fail `nc:listed`.
 */
import { rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { Window } from "happy-dom";
import React, { createElement } from "react";
import { createRoot } from "react-dom/client";
import { defineFlow, handler } from "@flow-state-dev/core";
import { isOneOffSessionId, oneOffSessionId } from "@flow-state-dev/core/helpers";
import type { BlockContext } from "@flow-state-dev/core/types";
import { createFlowState, runAction, type FlowState } from "@flow-state-dev/engine";
import { serve, type ServeHandle } from "@flow-state-dev/node";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import type { WorkerManifest } from "@flow-state-dev/workforce";
import { RUN_STAMP, installWorkers, silentLogger, sleep, workforceTree } from "../../lib/index.mts";

const USER = "alice";
const TOKEN = "tok-alice-nc";
const ORG = "acme";
const ASKER = "nc-asker";
const PROMPT = `Send the weekly report ${RUN_STAMP}?`;

type Fail = (tag: string, what: string) => void;

/**
 * The asker's flow: its door stops for an approval, and says what it was told. A hired worker
 * flow can't run with no session (its sessions' create check needs the worker's id, and a
 * run with no session is checked as a create), so this is a flow the host registers itself
 * and names in its org's inventory, as a host that runs a worker's work on its own flow may.
 */
function askerFlow() {
  const doorInput = z.object({ message: z.string() });
  const turn = handler({
    name: "nc-asker-turn",
    inputSchema: doorInput,
    outputSchema: z.unknown(),
    execute: async (_input, rawCtx) => {
      const ctx = rawCtx as unknown as BlockContext;
      return { sent: await ctx.suspendForUser({ kind: "approval", prompt: PROMPT } as never) };
    },
  });
  return defineFlow({ kind: ASKER, actions: { respond: { inputSchema: doorInput, block: turn, durable: true } } } as never)();
}

async function host(scratch: string): Promise<{ state: FlowState; flows: Record<string, any>; handle: ServeHandle; base: string }> {
  const worker = (id: string, declared: Record<string, unknown>): WorkerManifest => ({ id, declared, body: "", skills: [] });
  const { copies } = await installWorkers(workforceTree([worker("ops.helper", { description: "Helps." })]));
  const flows: Record<string, any> = { ...Object.fromEntries(copies.map((copy) => [copy.id, copy])), [ASKER]: askerFlow() };
  const filename = join(scratch, `no-conversation-${RUN_STAMP}.db`);
  rmSync(filename, { force: true });
  const state = createFlowState({
    flows: Object.values(flows),
    stores: { default: { primary: sqliteStores({ filename }) } },
    logger: silentLogger,
    resolvePrincipal: (context: any) => ((context.request?.headers.get("authorization") ?? "").replace(/^Bearer /, "") === TOKEN ? { userId: USER, orgId: ORG } : null),
  } as never);
  const runtime = await state.getRuntime();
  // The org's inventory names the asker's worker on its flow, as the host's boot writes a row.
  await runtime.stores.resourceState.set(
    "org",
    ORG,
    "inventory/workers/ops.asker",
    { id: "ops.asker", kind: ASKER, door: "respond", doorTakesTask: false, name: null, teamName: null, rules: false, hired: false, incarnation: null } as never,
    "any" as never,
  );
  const handle = await serve(await state.getRouter(), { port: 0, host: "127.0.0.1", handleSignals: false, shutdownGraceMs: 200 });
  return { state, flows, handle, base: `http://127.0.0.1:${handle.port}` };
}

/** Wait until `read` answers something `done` takes, polling every 50 ms, at most `ms`. */
async function until<T>(read: () => T | Promise<T>, done: (value: T) => boolean, ms: number): Promise<T> {
  let last = await read();
  for (const deadline = Date.now() + ms; !done(last) && Date.now() < deadline; last = await read()) await sleep(50);
  return last;
}

export async function legNoConversation(scratch: string, fail: Fail, note: (line: string) => void): Promise<void> {
  const on = await host(scratch);
  // A DOM for react-dom, set only for this leg.
  const happy = new Window({ url: `${on.base}/inbox` });
  const saved = { window: (globalThis as any).window, document: (globalThis as any).document, React: (globalThis as any).React };
  Object.assign(globalThis, { window: happy, document: happy.document, IS_REACT_ACT_ENVIRONMENT: false, React });
  let root: ReturnType<typeof createRoot> | undefined;
  try {
    const runtime = await on.state.getRuntime();
    const asker = Object.values(on.flows).find((flow) => flow.kind === ASKER);
    // The run: by the server, in a one-off session, with no conversation behind it.
    const ran = runAction({ flow: asker, actionName: "respond", input: { message: "the weekly report" }, userId: USER, orgId: ORG, sessionId: oneOffSessionId(), source: "system", stores: runtime.stores, runtimeConfig: runtime.runtimeConfig } as never) as Promise<{ requestId?: string; status?: string; error?: unknown }>;
    const requests = async () => (await runtime.stores.request.list({ orderBy: "none", limit: 100 } as never)) as Array<{ id: string; status: string; flowKind: string; sessionId?: string }>;
    const stopped = (await until(requests, (all) => all.some((r) => r.flowKind === ASKER && r.status === "suspended"), 15_000)).find((r) => r.flowKind === ASKER);
    if (stopped?.status !== "suspended" || stopped.sessionId === undefined || !isOneOffSessionId(stopped.sessionId)) {
      fail("nc:listed", `setup: the run with no conversation never stopped: ${JSON.stringify(stopped)}; ${JSON.stringify(await Promise.race([ran, sleep(10).then(() => "running")]))}`);
      return;
    }

    // Shift Manager's Inbox, drawn on the item's route: the item's id is the stop's own (it has no task).
    const { LabProvider, useLab } = await import("../../../packages/shift-manager/src/lib/lab-data.tsx");
    const { useGate } = await import("../../../packages/shift-manager/src/lib/gate.ts");
    const { Inbox } = await import("../../../packages/shift-manager/src/surfaces/Inbox.tsx");
    const { GAPS } = await import("../../../packages/shift-manager/src/gaps.ts");
    const container = happy.document.createElement("div");
    happy.document.body.appendChild(container);
    const { useInbox } = await import("../../../packages/shift-manager/src/lib/inbox.ts");
    const { SessionFeedsProvider } = await import("../../../packages/shift-manager/src/lib/session-feeds.tsx");
    // The Inbox on its first item's route, as a click on the item opens it.
    function Page() {
      // The shell draws the Inbox once the gate lets Shift Manager in, as the page does (`App.tsx`),
      // under the page's session feeds, as the app's shell draws every screen.
      const inside = useGate().gate.state === "in";
      const inbox = useInbox(inside);
      const { client } = useLab();
      if (!inside) return null;
      const itemId = inbox.section?.ok === true ? (inbox.section.value.items[0]?.id ?? null) : null;
      return createElement(SessionFeedsProvider, { client, children: createElement(Inbox, { itemId, gaps: GAPS }) });
    }
    root = createRoot(container as unknown as Element);
    root.render(createElement(LabProvider, { connection: { userId: USER, bearerToken: TOKEN, baseUrl: on.base }, children: createElement(Page) }));

    const items = () => [...container.querySelectorAll('[data-testid="inbox-item"]')] as unknown as HTMLElement[];
    await until(items, (list) => list.length > 0, 10_000);
    const listed = items();
    const from = listed.map((el) => el.querySelector('[data-testid="inbox-item-from"]')?.textContent ?? "");
    if (listed.length !== 1) fail("nc:listed", `the Inbox lists ${listed.length} item(s): ${JSON.stringify(from)}`);
    else if (listed[0]!.getAttribute("data-session-id") !== null || !/no conversation/.test(from[0]!) || /ops\.asker/.test(from[0]!)) {
      fail("nc:listed", `the ask is listed from ${JSON.stringify(from[0])} in session ${listed[0]!.getAttribute("data-session-id")}, not from no named worker with no conversation`);
    } else note(`nc: the Inbox lists the ask once, from "${from[0]}"`);

    const blocked = await until(() => container.querySelector('[data-testid="inbox-reply-blocked"]')?.textContent ?? null, (text) => text !== null, 5_000);
    if (blocked === null || !/no conversation/.test(blocked)) fail("nc:no-reply", `the reply box under the ask says ${JSON.stringify(blocked)}, not that there is no conversation to reply into`);

    // Approve, on the ask's own card.
    const approve = await until(
      () => ([...container.querySelectorAll("button")] as unknown as HTMLButtonElement[]).find((button) => button.textContent === "Approve"),
      (button) => button !== undefined && !button.disabled,
      5_000,
    );
    if (approve === undefined) {
      fail("nc:answer-resumes", "the ask's card offers no Approve");
      return;
    }
    approve.click();
    const after = (await until(requests, (all) => all.some((r) => r.id === stopped.id && r.status === "completed"), 15_000)).find((r) => r.id === stopped.id);
    if (after?.status !== "completed") fail("nc:answer-resumes", `after Approve the run reads ${after?.status}, not completed`);
    else note("nc: Approve answered the ask, and the run with no conversation completed");
    const gone = await until(items, (list) => list.length === 0, 5_000);
    if (gone.length !== 0) fail("nc:answer-resumes", "the answered ask is still listed");
  } finally {
    root?.unmount();
    Object.assign(globalThis, saved);
    await on.handle.close();
    await on.state.dispose();
  }
}
