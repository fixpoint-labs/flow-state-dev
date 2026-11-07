/**
 * The Postgres bus under the session stream (FIX-2427): a write that lands
 * after a view's first read but before the view's process is listening must
 * still reach the view. Until the bus hears its first ping it says it does
 * not cross, so the view is on its timed read; the moment it says it does,
 * the timer stops, and a change made in that gap would never be read unless
 * the first connection tells every subscriber to read once.
 *
 * Two routers over one PGlite stand in for two processes; the fake network
 * carries `NOTIFY`, and holds process 2's `LISTEN` until the write has landed.
 */
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import type { SessionStreamEvent } from "@flow-state-dev/core/items";
import { createFlowApiRouter, createFlowRegistry, disposeFlowApiRouter, type StoreRegistry } from "@flow-state-dev/engine";
import { PGlite } from "@electric-sql/pglite";
import { createPostgresStores, type QueryExecutor } from "../src/host";
import { createPostgresBus, type PostgresBus } from "../src/bus";
import { FakeNotifyNetwork, delay, until } from "./fake-notify-network";

const TIMINGS = { pingIntervalMs: 20, staleAfterMs: 50, reconnectMinMs: 5, reconnectMaxMs: 20 };

function chatFlow() {
  const say = handler({
    name: "chat-say",
    execute: async (input, ctx) => {
      ctx.emit.message((input as { text: string }).text);
      return {};
    }
  });
  return defineFlow({ kind: "chat", actions: { say: { block: say } } })();
}

function executorOver(pglite: PGlite): QueryExecutor {
  return {
    async query(text: string, values?: unknown[]) {
      const result = await pglite.query(text, values);
      return { rows: result.rows as Record<string, unknown>[], rowCount: result.affectedRows ?? 0 };
    }
  };
}

type Server = { router: ReturnType<typeof createFlowApiRouter>; stores: StoreRegistry; bus: PostgresBus };

async function server(pglite: PGlite, network: FakeNotifyNetwork, listens: boolean): Promise<Server> {
  const stores = await createPostgresStores({ executor: executorOver(pglite) });
  const bus = createPostgresBus({
    executor: network.executor,
    liveTailPool: listens ? network.pool : null,
    notify: true,
    timings: TIMINGS
  });
  const registry = createFlowRegistry();
  registry.register(chatFlow());
  const withBus = { ...stores, bus };
  return { router: createFlowApiRouter({ registry, stores: withBus, staleSweepIntervalMs: 0 }), stores: withBus, bus };
}

async function say(on: Server, text: string): Promise<void> {
  const res = await on.router.POST(
    new Request("http://localhost/api/flows/chat/s1/actions/say", {
      method: "POST",
      body: JSON.stringify({ userId: "alice", orgId: DEFAULT_ORG_ID, input: { text } })
    }),
    { params: { path: ["chat", "s1", "actions", "say"] } }
  );
  expect(res.status).toBe(202);
  const id = ((await res.json()) as { request: { id: string } }).request.id;
  const deadline = Date.now() + 3_000;
  for (;;) {
    const record = await on.stores.request.get(id);
    if (record !== undefined && record.status !== "in_progress") return;
    if (Date.now() > deadline) throw new Error("the reply never finished");
    await delay(5);
  }
}

function textOf(event: SessionStreamEvent): string | undefined {
  if (event.type !== "session.item" || event.item.type !== "message") return undefined;
  return (event.item.content as Array<{ text?: string }>)[0]?.text;
}

async function openView(on: Server): Promise<{ events: SessionStreamEvent[]; close(): Promise<void> }> {
  const controller = new AbortController();
  const res = await on.router.GET(new Request("http://localhost/api/flows/sessions/s1/stream", { signal: controller.signal }), {
    params: { path: ["sessions", "s1", "stream"] }
  });
  expect(res.status).toBe(200);
  const events: SessionStreamEvent[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const reading = (async () => {
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        for (let at = buffer.indexOf("\n\n"); at >= 0; at = buffer.indexOf("\n\n")) {
          const data = buffer
            .slice(0, at)
            .split("\n")
            .filter((line) => line.startsWith("data: "))
            .map((line) => line.slice(6))
            .join("\n");
          buffer = buffer.slice(at + 2);
          if (data !== "") events.push(JSON.parse(data) as SessionStreamEvent);
        }
      }
    } catch {
      // Closed by the test.
    }
  })();
  return {
    events,
    async close() {
      controller.abort();
      await reading;
    }
  };
}

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

describe("the Postgres bus under the session stream", () => {
  it("reaches a view with a write made after its first read and before its process listens", async () => {
    const pglite = new PGlite();
    const network = new FakeNotifyNetwork();
    let listen!: () => void;
    network.listenGate = new Promise<void>((resolve) => (listen = resolve));
    const p1 = await server(pglite, network, false);
    const p2 = await server(pglite, network, true);
    cleanup.push(async () => {
      listen();
      await Promise.all([disposeFlowApiRouter(p1.router), disposeFlowApiRouter(p2.router)]);
      await Promise.all([p1.bus.close(), p2.bus.close()]);
      await pglite.close();
    });

    await say(p1, "opening");
    const view = await openView(p2);
    cleanup.push(() => view.close());
    // The view's first read is done; its process is not listening yet.
    await until(() => view.events.some((e) => e.type === "session.runs"));
    expect(network.listeners("fsd_bus")).toEqual([]);

    // Its notice goes out while nobody on process 2 listens, and is gone.
    await say(p1, "the reply, in the gap");
    listen();
    await until(() => p2.bus.crossesProcesses);

    // No later write: only the first connection's resync can make the view read.
    await until(() => view.events.some((e) => textOf(e) === "the reply, in the gap"), 3_000);
  });
});
