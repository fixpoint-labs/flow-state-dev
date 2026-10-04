/**
 * Session routing parity: where a session-scoped key stores, asked of both
 * paths that resolve it.
 *
 * A key declared `sharedToLineage` lives at the lineage address; everything
 * else lives at the running session's own address. Execution answers that
 * through `createExecutionContext` (the bucket builder behind `ctx.resources`),
 * the HTTP resource and state routes through `sessionKeyScopeId` +
 * `sessionStorageScope`. Both read the one session routing index in
 * `resources/lineage-scope.ts`.
 *
 * Each probe seeds two different rows for one storage key in a child session of
 * a lineage: one marked `SESSION` at the child's own address, one marked
 * `LINEAGE` at the lineage address. The marker execution reads back is the
 * address it routed to. Every probe asserts each path's ABSOLUTE address, not
 * only that the two agree, so a rule that is wrong the same way on both sides
 * still fails.
 *
 * The conflicting-prefix case is the one intentional asymmetry: execution
 * refuses the flow, while the HTTP helpers keep answering with the first
 * declaration winning the tie. Both halves are pinned below.
 */
import {
  defineFlow,
  defineResource,
  defineResourceCollection,
  handler,
  DEFAULT_ORG_ID
} from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createExecutionContext, createInMemoryStores } from "../src";
import { sessionKeyScopeId, sessionStorageScope } from "../src/resources/lineage-scope";
import type { SessionRecord, StoreRegistry } from "../src/stores/types";

const schema = z.object({ note: z.string().default("") });
const noop = handler({ name: "noop", execute: () => "ok" });
const LINEAGE = "lin_root";
const ROOT = "s_root";
const CHILD = "s_child";
const SESSION = { id: CHILD, userId: "u_1", lineageId: LINEAGE };

type Address = "SESSION" | "LINEAGE";
type Read = (resources: Record<string, unknown>) => Promise<string>;
type Probe = { label: string; storageKey: string; read: Read; expect: Address };
type Shape = { name: string; resources: Record<string, unknown>; probes: Probe[] };

const single =
  (accessor: string): Read =>
  async (res) =>
    (res[accessor] as { state: { note: string } }).state.note;
const instance =
  (accessor: string, key: string | Record<string, string>): Read =>
  async (res) =>
    (await (res[accessor] as { get(k: unknown): Promise<{ state: { note: string } }> }).get(key))
      .state.note;

const sharedSingle = () =>
  defineResource({ scope: "session", sharedToLineage: true, ref: "board", stateSchema: schema });
const privateSingle = () => defineResource({ scope: "session", ref: "scratch", stateSchema: schema });
const coll = (pattern: string, shared: boolean) =>
  defineResourceCollection({
    pattern,
    scope: "session",
    ...(shared ? { sharedToLineage: true } : {}),
    stateSchema: schema
  });

const nested = (order: "shared-first" | "private-first"): Shape => {
  const shared = coll("tasks/**", true);
  const priv = coll("tasks/meta/*", false);
  return {
    name: `private prefix nested under a shared one (${order})`,
    resources: order === "shared-first" ? { shared, priv } : { priv, shared },
    probes: [
      { label: "nested private owns its key", storageKey: "tasks/meta/a", read: instance("priv", "a"), expect: "SESSION" },
      { label: "broad shared keeps the rest", storageKey: "tasks/b", read: instance("shared", "b"), expect: "LINEAGE" }
    ]
  };
};

/** The declaration matrix: 12 probes across 7 shapes. */
const shapes: Shape[] = [
  {
    name: "shared single beside a private single",
    resources: { board: sharedSingle(), scratch: privateSingle() },
    probes: [
      { label: "shared single", storageKey: "board", read: single("board"), expect: "LINEAGE" },
      { label: "private single", storageKey: "scratch", read: single("scratch"), expect: "SESSION" }
    ]
  },
  {
    name: "unaliased shared single (no ref)",
    resources: { plain: defineResource({ scope: "session", sharedToLineage: true, stateSchema: schema }) },
    probes: [{ label: "unaliased shared single", storageKey: "plain", read: single("plain"), expect: "LINEAGE" }]
  },
  {
    name: "static-prefix collections, one shared and one private",
    resources: { tasks: coll("tasks/*", true), notes: coll("notes/*", false) },
    probes: [
      { label: "shared collection instance", storageKey: "tasks/x", read: instance("tasks", "x"), expect: "LINEAGE" },
      { label: "private collection instance", storageKey: "notes/x", read: instance("notes", "x"), expect: "SESSION" }
    ]
  },
  nested("shared-first"),
  nested("private-first"),
  {
    name: "empty-prefix shared collection beside a private single",
    resources: { obs: coll("[t]/observations", true), scratch: privateSingle() },
    probes: [
      { label: "private single under an empty shared prefix", storageKey: "scratch", read: single("scratch"), expect: "SESSION" },
      { label: "empty-prefix shared instance", storageKey: "x/observations", read: instance("obs", { t: "x" }), expect: "LINEAGE" }
    ]
  },
  {
    name: "two collections on one prefix with the same flag",
    resources: { a: coll("[t]/notes", true), b: coll("[t]/events", true) },
    probes: [
      { label: "same-prefix same-flag instance", storageKey: "x/events", read: instance("b", { t: "x" }), expect: "LINEAGE" }
    ]
  }
];

let flowCounter = 0;
function flowOf(resources: Record<string, unknown>): FlowInstance {
  flowCounter += 1;
  return defineFlow({
    kind: `routing-parity-${flowCounter}`,
    actions: { run: { inputSchema: z.string(), block: noop } },
    resources: resources as never
  })();
}

async function seedLineage(stores: StoreRegistry, flow: FlowInstance): Promise<void> {
  const ts = 1_700_000_000_000;
  for (const [id, parent] of [
    [ROOT, undefined],
    [CHILD, ROOT]
  ] as const) {
    await stores.session.set(
      id,
      {
        orgId: DEFAULT_ORG_ID,
        id,
        flowKind: flow.kind,
        userId: "u_1",
        state: {},
        version: 0,
        createdAt: ts,
        updatedAt: ts,
        journal: [],
        lineageId: LINEAGE,
        ...(parent !== undefined ? { parentSessionId: parent } : {})
      } satisfies SessionRecord,
      "any"
    );
  }
}

function contextFor(stores: StoreRegistry, flow: FlowInstance) {
  return createExecutionContext({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "run",
    requestId: `req_${flow.kind}`,
    sessionId: CHILD,
    userId: "u_1",
    stores
  });
}

/** The address the HTTP helpers resolve a storage key to. */
function httpAddress(flow: FlowInstance, storageKey: string): Address {
  const scopeId = sessionKeyScopeId(SESSION, flow.resources, storageKey, undefined);
  return sessionStorageScope(SESSION, scopeId) === "lineage" ? "LINEAGE" : "SESSION";
}

describe("session routing parity: execution and the HTTP helpers resolve every key to one address", () => {
  for (const shape of shapes) {
    describe(shape.name, () => {
      for (const probe of shape.probes) {
        it(`${probe.label} → ${probe.expect} on both paths`, async () => {
          const flow = flowOf(shape.resources);
          const stores = createInMemoryStores();
          await seedLineage(stores, flow);
          for (const p of shape.probes) {
            await stores.resourceState.set("session", CHILD, p.storageKey, { note: "SESSION" }, "any");
            await stores.resourceState.set("lineage", LINEAGE, p.storageKey, { note: "LINEAGE" }, "any");
          }
          const ctx = await contextFor(stores, flow);

          const execution = await probe.read(ctx.resources as unknown as Record<string, unknown>);
          const http = httpAddress(flow, probe.storageKey);

          expect({ execution, http }).toEqual({ execution: probe.expect, http: probe.expect });
        });
      }
    });
  }

  describe("two collections on one prefix with conflicting flags", () => {
    it("execution refuses the flow at context construction", async () => {
      const flow = flowOf({ a: coll("[t]/notes", true), b: coll("[t]/events", false) });
      await expect(contextFor(createInMemoryStores(), flow)).rejects.toThrow(
        /conflicting sharedToLineage/
      );
    });

    it("the HTTP helpers still answer, the first declaration winning the tie", () => {
      // Refusing over HTTP too would be a behaviour change: a flow the routes
      // answer today must keep answering. Declaration order is the tie-break,
      // so reversing it flips the address.
      const sharedFirst = flowOf({ a: coll("[t]/notes", true), b: coll("[t]/events", false) });
      const privateFirst = flowOf({ b: coll("[t]/events", false), a: coll("[t]/notes", true) });
      expect(httpAddress(sharedFirst, "x/events")).toBe("LINEAGE");
      expect(httpAddress(privateFirst, "x/events")).toBe("SESSION");
    });
  });
});
