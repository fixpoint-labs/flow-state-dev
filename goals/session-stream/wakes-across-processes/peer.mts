/**
 * One process of the goal (FIX-2427): `createFlowState` over `postgresStores`
 * on the shared database, as an app's process holds it, driven by the runner
 * over IPC (`goals/lib/peers.mts`).
 *
 * Every statement this process sends, on any connection (the stores' pool and
 * the tail pool alike), passes through one `pg.Client` subclass, so the
 * runner can ask what this process asked the database while counting was on.
 * The bus's own traffic (its ping, its `LISTEN`) is counted apart.
 */
import { z } from "zod";
import pg from "pg";
import { DEFAULT_ORG_ID, defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import type { SessionStreamEvent } from "@flow-state-dev/core/items";
import { createFlowState, type StoreRegistry } from "@flow-state-dev/engine";
import { type FlowApiRouter } from "@flow-state-dev/engine/host";
import { postgresStores } from "@flow-state-dev/store-postgres";
import { servePeer } from "../../lib/peers.mts";

const NAME = process.env.GOAL_PEER_NAME ?? "peer";
const URL_ = process.env.GOAL_DB_URL!;
const TAIL = process.env.GOAL_TAIL !== "off";

// ---------------------------------------------------------------------------
// What this process asks the database
// ---------------------------------------------------------------------------

const counted = { on: false, statements: 0, pings: 0, bus: 0, texts: [] as string[] };

/** Every connection this process opens is one of these. */
class CountingClient extends pg.Client {
  // pg's overloads; only the text and values are read.
  override query(...args: any[]): any {
    if (counted.on) {
      const config = args[0] as string | { text?: string; values?: unknown[] };
      const text = typeof config === "string" ? config : (config?.text ?? "");
      const values = (Array.isArray(args[1]) ? args[1] : typeof config === "object" ? config?.values : undefined) ?? [];
      if (/^\s*(UN)?LISTEN fsd_bus\b/i.test(text)) counted.bus += 1;
      else if (/pg_notify/i.test(text) && String(values[1] ?? "").includes('"ping"')) counted.pings += 1;
      else {
        counted.statements += 1;
        if (counted.texts.length < 20) counted.texts.push(text.replace(/\s+/g, " ").slice(0, 120));
      }
    }
    return (super.query as (...a: any[]) => any)(...args);
  }
}

// ---------------------------------------------------------------------------
// The app
// ---------------------------------------------------------------------------

let releaseRun: () => void = () => {};

function chatFlow() {
  const say = handler({
    name: "chat-say",
    execute: async (input, ctx) => {
      ctx.emit.message((input as { text: string }).text);
      return {};
    }
  });
  const work = handler({
    name: "chat-work",
    execute: async () => {
      await new Promise<void>((resolve) => (releaseRun = resolve));
      return {};
    }
  });
  return defineFlow({
    kind: "chat",
    actions: {
      say: { block: say },
      spawn: {
        block: dispatcher({
          name: "chat-spawn",
          action: "work",
          inputSchema: z.object({ key: z.string() }),
          session: { key: (input: { key: string }) => input.key },
          payload: () => ({})
        })
      }
    },
    internal: { actions: { work: { block: work } } }
  })();
}

const flowState = createFlowState({
  flows: [chatFlow()],
  stores: {
    default: {
      primary: postgresStores({
        connectionString: URL_,
        poolOptions: { Client: CountingClient as unknown as typeof pg.Client, application_name: `goal-${NAME}` },
        ...(TAIL ? {} : { liveTailPool: null })
      })
    }
  },
  staleSweepIntervalMs: 0,
  detectInterruptedOnStartup: false
});
const router: FlowApiRouter = await flowState.getRouter();
const stores: StoreRegistry = (await flowState.getRuntime()).stores;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const views = new Map<number, AbortController>();
let nextView = 0;

const peer = servePeer({
  async act({ session, action, input }: { session: string; action: string; input: Record<string, unknown> }) {
    const res = await router.POST(
      new Request(`http://localhost/api/flows/chat/${session}/actions/${action}`, {
        method: "POST",
        body: JSON.stringify({ userId: "alice", orgId: DEFAULT_ORG_ID, input })
      }),
      { params: { path: ["chat", session, "actions", action] } }
    );
    if (res.status !== 202) throw new Error(`POST ${action} answered ${res.status}: ${await res.text()}`);
    return ((await res.json()) as { request: { id: string } }).request.id;
  },

  /** When `requestId` is saved finished, read off this process's store every 5 ms. */
  async savedAt({ requestId }: { requestId: string }) {
    const deadline = Date.now() + 5_000;
    for (;;) {
      const record = await stores.request.get(requestId);
      if (record !== undefined && record.status !== "in_progress") return Date.now();
      if (Date.now() > deadline) throw new Error(`request ${requestId} never finished`);
      await delay(5);
    }
  },

  /** When a run under `session` first has a running request, polled every 5 ms. */
  async runStartedAt({ session }: { session: string }) {
    const deadline = Date.now() + 5_000;
    for (;;) {
      const children = await stores.session.list({ parentage: { parentOf: session } });
      if (children.length > 0) {
        const running = await stores.request.list({
          sessionId: children.map((child) => child.id),
          status: ["in_progress", "suspended"],
          orderBy: "none"
        });
        if (running.length > 0) return Date.now();
      }
      if (Date.now() > deadline) throw new Error("the background run never started");
      await delay(5);
    }
  },

  releaseRun() {
    releaseRun();
  },

  /** Open a view of `session`; each event it receives is pushed as `frame`, stamped when received. */
  async openView({ session }: { session: string }) {
    const view = (nextView += 1);
    const controller = new AbortController();
    const res = await router.GET(
      new Request(`http://localhost/api/flows/sessions/${session}/stream`, { signal: controller.signal }),
      { params: { path: ["sessions", session, "stream"] } }
    );
    if (res.status !== 200 || res.body === null) throw new Error(`the stream answered ${res.status}`);
    views.set(view, controller);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    void (async () => {
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
            if (data !== "") peer.push("frame", { view, at: Date.now(), event: JSON.parse(data) as SessionStreamEvent });
          }
        }
      } catch {
        // Closed.
      }
    })();
    return view;
  },

  closeView({ view }: { view: number }) {
    views.get(view)?.abort();
    views.delete(view);
  },

  /** Start counting from zero, or stop and return what was counted. */
  count({ on }: { on: boolean }) {
    if (on) Object.assign(counted, { on: true, statements: 0, pings: 0, bus: 0, texts: [] });
    else counted.on = false;
    return { statements: counted.statements, pings: counted.pings, bus: counted.bus, texts: counted.texts };
  },

  crosses() {
    return stores.bus?.crossesProcesses === true;
  },

  async stop() {
    for (const controller of views.values()) controller.abort();
    releaseRun();
    await flowState.dispose();
  }
});
