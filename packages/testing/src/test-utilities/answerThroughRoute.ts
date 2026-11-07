/**
 * How a test answers a stop: through the engine's own answer or resume
 * route, in process, the door a screen uses.
 *
 * Each call builds a router over the test's stores and runtime config, posts
 * the answer, and reads what followed the way a client does: the route's
 * stream of the continued run, which closes when the run settles, then one
 * read of the request's status route. The router is disposed before the call
 * returns, so no timer of its outlives the test. A refusal (an action the
 * stop doesn't allow, a second answer, data that fails its schema, a stop
 * that isn't there) throws a {@link StopRefusedError} with the route's status
 * and message.
 */
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInProcessFetch,
  disposeFlowApiRouter,
  type StoreRegistry
} from "@flow-state-dev/engine";
import type { RuntimeConfig } from "@flow-state-dev/engine/host";
import type { FlowInstance, RequestStatus } from "@flow-state-dev/core/types";
import { ITEM_UPDATE_INVARIANT_KEYS, type OutputItem, type RequestStreamEvent } from "@flow-state-dev/core/items";

/** A route's refusal of an answer, as a screen would be told it. */
export class StopRefusedError extends Error {
  /** The route's HTTP status (404, 409, 400, 410). */
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "StopRefusedError";
    this.status = status;
  }
}

export type RouteAnswer = {
  route: "answer" | "resume";
  suspensionId: string;
  action: string;
  data?: unknown;
  headers?: Record<string, string>;
};

/** What followed the answer: the run's status and the items emitted after the stop. */
export type RouteOutcome = { status: RequestStatus; items: OutputItem[] };

export async function answerThroughRoute(
  context: { flow: FlowInstance; stores: StoreRegistry; runtimeConfig: RuntimeConfig; requestId: string },
  answer: RouteAnswer
): Promise<RouteOutcome> {
  const registry = createFlowRegistry();
  registry.register(context.flow);
  const router = createFlowApiRouter({
    registry,
    stores: context.stores,
    runtimeConfig: context.runtimeConfig,
    staleSweepIntervalMs: 0,
    detectInterruptedOnStartup: false
  });
  try {
    const fetcher = createInProcessFetch(router);
    const base = `/api/flows/${encodeURIComponent(context.flow.id)}/requests/${encodeURIComponent(context.requestId)}`;
    const res = await fetcher(`${base}/${answer.route}`, {
      method: "POST",
      headers: { ...answer.headers, "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({
        suspensionId: answer.suspensionId,
        action: answer.action,
        ...(answer.data !== undefined ? { data: answer.data } : {})
      })
    });
    if (!res.ok) throw new StopRefusedError(res.status, await refusalMessage(res));
    const items = await itemsOf(res);
    const statusRes = await fetcher(`${base}/status`, { headers: answer.headers });
    if (!statusRes.ok) throw new StopRefusedError(statusRes.status, await refusalMessage(statusRes));
    const snapshot = (await statusRes.json()) as { status: RequestStatus };
    return { status: snapshot.status, items };
  } finally {
    await disposeFlowApiRouter(router);
  }
}

async function refusalMessage(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const body = JSON.parse(text) as { error?: string };
    return body.error ?? text;
  } catch {
    return text;
  }
}

/**
 * The items a request's SSE stream carried, in item order: each item as it
 * was last sent (`item.added`, then `item.done`, with `item.updated` patches
 * merged). Reads to the stream's end, which comes when the run settles.
 */
async function itemsOf(res: Response): Promise<OutputItem[]> {
  const byId = new Map<string, OutputItem>();
  const text = await res.text();
  for (const frame of text.split("\n\n")) {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data === "") continue;
    let event: RequestStreamEvent;
    try {
      event = JSON.parse(data) as RequestStreamEvent;
    } catch {
      continue;
    }
    if (event.type === "item.added" || event.type === "item.done") byId.set(event.item.id, event.item);
    else if (event.type === "item.updated") {
      // Merged as the client merges it: identity keys in a patch are ignored.
      const current = byId.get(event.itemId);
      if (current === undefined) continue;
      const patch = Object.fromEntries(
        Object.entries(event.patch).filter(([key]) => !(ITEM_UPDATE_INVARIANT_KEYS as readonly string[]).includes(key))
      );
      byId.set(event.itemId, { ...current, ...patch } as OutputItem);
    }
  }
  return [...byId.values()].sort((a, b) => a.itemIndex - b.itemIndex);
}
