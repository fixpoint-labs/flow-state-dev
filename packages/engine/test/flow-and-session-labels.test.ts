/**
 * What a flow and its sessions say about themselves to a reader (FIX-2875).
 *
 * A flow's `description` goes out on the flow list, and a flow's
 * `session.label` names each session on every read of it, from the state
 * the session shows. Both are display only. A reader such as the developer
 * tool draws them instead of hashed ids, so a flow whose session ids are
 * derived (`wks_…`, `dsx_…`) still reads by who and what.
 */
import { defineFlow, handler, DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { FlowInstance, JsonObject } from "@flow-state-dev/core/types";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createFlowApiRouter, createFlowRegistry, type StoreRegistry } from "../src";
import { createInMemoryStores } from "../src/host";

const run = handler({ name: "run", inputSchema: z.object({}), execute: () => ({}) });

const NAMES: Record<string, string> = { "desk.amy": "Amy" };

const workers = defineFlow({
  kind: "workers",
  description: "Every worker without a flow of its own talks here.",
  actions: { run },
  session: {
    stateSchema: z.object({ workerId: z.string().readonly(), notes: z.string().default("") }),
    label: ({ state }) => {
      const worker = state.workerId;
      return typeof worker === "string" ? (NAMES[worker] ?? worker) : undefined;
    }
  }
});

const throwing = defineFlow({
  kind: "throwing",
  actions: { run },
  session: {
    label: () => {
      throw new Error("label broke");
    }
  }
});

const plain = defineFlow({ kind: "plain", actions: { run } });

function host(stores: StoreRegistry) {
  const registry = createFlowRegistry();
  registry.registerMany([workers(), throwing(), plain()] as unknown as FlowInstance[]);
  return createFlowApiRouter({ registry, stores });
}

async function seed(stores: StoreRegistry, id: string, flow: string, state: JsonObject, title?: string) {
  const now = Date.now();
  await stores.session.set(
    id,
    {
      id,
      orgId: DEFAULT_ORG_ID,
      flowKind: flow,
      flowId: flow,
      userId: "u_1",
      state,
      version: 0,
      createdAt: now,
      updatedAt: now,
      journal: [],
      ...(title === undefined ? {} : { title })
    },
    "any"
  );
}

async function get(router: ReturnType<typeof createFlowApiRouter>, path: string): Promise<any> {
  const response = await router.GET(new Request(`http://localhost/api/flows/${path}`), {
    params: { path: path === "" ? [] : path.split("?")[0]!.split("/") }
  });
  expect(response.status).toBe(200);
  return response.json();
}

describe("a flow's description", () => {
  it("goes out on the flow list, and a flow with none sends none", async () => {
    const body = await get(host(createInMemoryStores()), "");
    const byId = Object.fromEntries(body.flows.map((flow: { id: string }) => [flow.id, flow]));
    expect(byId.workers.description).toBe("Every worker without a flow of its own talks here.");
    expect(byId.plain).not.toHaveProperty("description");
  });
});

describe("a flow's session label", () => {
  it("names each listed session from its state, and is left off where the flow names nothing", async () => {
    const stores = createInMemoryStores();
    await seed(stores, "wks_aa11", "workers", { workerId: "desk.amy" });
    await seed(stores, "wks_bb22", "workers", { workerId: "hired-one" });
    await seed(stores, "sess_plain", "plain", {});
    const body = await get(host(stores), "sessions?userId=u_1");
    const byId = Object.fromEntries(body.sessions.map((s: { id: string }) => [s.id, s]));

    expect(byId.wks_aa11.label).toBe("Amy");
    // A worker the flow cannot name reads as its id rather than as a hash.
    expect(byId.wks_bb22.label).toBe("hired-one");
    expect(byId.sess_plain).not.toHaveProperty("label");
  });

  it("is on the single-session read too", async () => {
    const stores = createInMemoryStores();
    await seed(stores, "wks_aa11", "workers", { workerId: "desk.amy" });
    const body = await get(host(stores), "sessions/wks_aa11");
    expect(body.session.label).toBe("Amy");
  });

  it("sees only the state the session shows, so a label cannot publish a private field", async () => {
    const seen: unknown[] = [];
    const peeking = defineFlow({
      kind: "peeking",
      actions: { run },
      session: {
        stateSchema: z.object({ workerId: z.string().readonly(), secret: z.string().default("") }),
        label: ({ state }) => {
          seen.push(state);
          return undefined;
        }
      }
    });
    const stores = createInMemoryStores();
    const registry = createFlowRegistry();
    registry.registerMany([peeking()] as unknown as FlowInstance[]);
    await seed(stores, "s_peek", "peeking", { workerId: "w", secret: "hunter2" });
    await get(createFlowApiRouter({ registry, stores }), "sessions?userId=u_1");
    expect(seen).toEqual([{ workerId: "w" }]);
  });

  it("costs a listing nothing when it throws: that session goes out unlabelled", async () => {
    const stores = createInMemoryStores();
    await seed(stores, "s_throws", "throwing", {});
    const body = await get(host(stores), "sessions?userId=u_1");
    expect(body.sessions.map((s: { id: string }) => s.id)).toEqual(["s_throws"]);
    expect(body.sessions[0]).not.toHaveProperty("label");
  });
});
