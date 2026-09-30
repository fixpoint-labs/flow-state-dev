/**
 * POC · do the HTTP and execution copies of the session-shared-key rule agree today?
 *
 * Throwaway design evidence for FIX-1084. Not production code, not a workspace
 * package, in no default build, test, lint or knip discovery. Nothing outside
 * this folder imports it.
 *
 * For every declaration shape below, a child session of a lineage holds two
 * different rows for the same storage key: one at its own session address and
 * one at the lineage address. Execution reads the key through the ordinary
 * resource API, and the marker it gets back says which address execution
 * routed to. The HTTP side is asked the same question through the helpers the
 * resource routes call (`sessionKeyScopeId` + `sessionStorageScope`). Every
 * probe must agree.
 *
 * Control: `POC_CONTROL=flip` inverts the HTTP answer for one probe. The check
 * must then FAIL naming that probe, or it is not reaching what it claims to.
 *
 * Run: pnpm exec tsx specs/issues/FIX-1084/poc/parity-today/check.mts
 */
import { z } from "zod";
import {
  defineFlow,
  defineResource,
  defineResourceCollection,
  handler,
  DEFAULT_ORG_ID
} from "../../../../../packages/core/src/index.ts";
import {
  createExecutionContext,
  createInMemoryStores
} from "../../../../../packages/engine/src/index.ts";
import {
  sessionKeyScopeId,
  sessionStorageScope
} from "../../../../../packages/engine/src/resources/lineage-scope.ts";

const schema = z.object({ note: z.string().default("") });
const noop = handler({ name: "noop", execute: () => "ok" });
const LINEAGE = "lin_root";
const CHILD = "s_child";

type Read = (ctx: Record<string, unknown>) => Promise<string>;
type Probe = { label: string; storageKey: string; read: Read; expect: "SESSION" | "LINEAGE" };
type Shape = { name: string; resources: Record<string, unknown>; probes: Probe[] };

const single = (accessor: string): Read => async (res) =>
  (res[accessor] as { state: { note: string } }).state.note;
const instance = (accessor: string, topic: string | Record<string, string>): Read => async (res) =>
  (
    await (res[accessor] as { get(k: unknown): Promise<{ state: { note: string } }> }).get(topic)
  ).state.note;

const sharedSingle = () => defineResource({ scope: "session", sharedToLineage: true, ref: "board", stateSchema: schema });
const privateSingle = () => defineResource({ scope: "session", ref: "scratch", stateSchema: schema });
const coll = (pattern: string, shared: boolean) =>
  defineResourceCollection({ pattern, scope: "session", ...(shared ? { sharedToLineage: true } : {}), stateSchema: schema });

const shapes: Shape[] = [
  {
    name: "shared single beside private single",
    resources: { board: sharedSingle(), scratch: privateSingle() },
    probes: [
      { label: "shared single", storageKey: "board", read: single("board"), expect: "LINEAGE" },
      { label: "private single", storageKey: "scratch", read: single("scratch"), expect: "SESSION" }
    ]
  },
  {
    name: "unaliased single (no ref) shared",
    resources: { plain: defineResource({ scope: "session", sharedToLineage: true, stateSchema: schema }) },
    probes: [{ label: "unaliased shared single", storageKey: "plain", read: single("plain"), expect: "LINEAGE" }]
  },
  {
    name: "static-prefix collections, one shared one private",
    resources: { tasks: coll("tasks/*", true), notes: coll("notes/*", false) },
    probes: [
      { label: "shared collection instance", storageKey: "tasks/x", read: instance("tasks", "x"), expect: "LINEAGE" },
      { label: "private collection instance", storageKey: "notes/x", read: instance("notes", "x"), expect: "SESSION" }
    ]
  },
  ...(["shared-first", "private-first"] as const).map((order): Shape => {
    const shared = coll("tasks/**", true);
    const priv = coll("tasks/meta/*", false);
    return {
      name: `private prefix nested under shared (${order})`,
      resources: order === "shared-first" ? { shared, priv } : { priv, shared },
      probes: [
        { label: `nested private owns its key (${order})`, storageKey: "tasks/meta/a", read: instance("priv", "a"), expect: "SESSION" },
        { label: `broad shared keeps the rest (${order})`, storageKey: "tasks/b", read: instance("shared", "b"), expect: "LINEAGE" }
      ]
    };
  }),
  {
    name: "empty-prefix shared collection beside a private single",
    resources: { obs: coll("[t]/observations", true), scratch: privateSingle() },
    probes: [
      { label: "private single under empty shared prefix", storageKey: "scratch", read: single("scratch"), expect: "SESSION" },
      { label: "empty-prefix shared instance", storageKey: "x/observations", read: instance("obs", { t: "x" }), expect: "LINEAGE" }
    ]
  },
  {
    name: "two collections on one prefix, same flag",
    resources: { a: coll("[t]/notes", true), b: coll("[t]/events", true) },
    probes: [{ label: "same-prefix same-flag instance", storageKey: "x/events", read: instance("b", { t: "x" }), expect: "LINEAGE" }]
  }
];

const flipLabel = process.env.POC_CONTROL === "flip" ? "shared single" : undefined;
let failures = 0;
let probes = 0;
let n = 0;

for (const shape of shapes) {
  n += 1;
  const flow = defineFlow({ kind: `parity-${n}`, actions: { run: { inputSchema: z.string(), block: noop } }, resources: shape.resources as never })();
  const stores = createInMemoryStores();
  const ts = 1_700_000_000_000;
  for (const [id, parent] of [["s_root", undefined], [CHILD, "s_root"]] as const) {
    await stores.session.set(id, {
      orgId: DEFAULT_ORG_ID, id, flowKind: flow.kind, userId: "u_1", state: {}, version: 0,
      createdAt: ts, updatedAt: ts, journal: [], lineageId: LINEAGE,
      ...(parent ? { parentSessionId: parent } : {})
    } as never, "any");
  }
  for (const p of shape.probes) {
    await stores.resourceState.set("session", CHILD, p.storageKey, { note: "SESSION" }, "any");
    await stores.resourceState.set("lineage", LINEAGE, p.storageKey, { note: "LINEAGE" }, "any");
  }
  const ctx = await createExecutionContext({
    orgId: DEFAULT_ORG_ID, flow, actionName: "run", requestId: `req_${n}`, sessionId: CHILD, userId: "u_1", stores
  });
  const session = { id: CHILD, userId: "u_1", lineageId: LINEAGE };
  for (const p of shape.probes) {
    probes += 1;
    const execution = await p.read(ctx.resources as never);
    const scopeId = sessionKeyScopeId(session, flow.resources, p.storageKey, undefined);
    let http = sessionStorageScope(session, scopeId) === "lineage" ? "LINEAGE" : "SESSION";
    if (p.label === flipLabel) http = http === "LINEAGE" ? "SESSION" : "LINEAGE";
    const ok = execution === http && execution === p.expect;
    if (!ok) failures += 1;
    console.log(`${ok ? "agree " : "DIFFER"}  ${p.label.padEnd(46)} execution=${execution} http=${http} expected=${p.expect}`);
  }
}

// The one known asymmetry, reported rather than asserted: two collections on
// one storage prefix with CONFLICTING flags. Execution refuses the flow outright;
// the HTTP helpers still answer (declaration order breaks the tie). Execution
// never produces an address here, so there is nothing for HTTP to disagree
// with, but the refactor must keep HTTP from starting to throw (SPEC BR-4).
{
  const flow = defineFlow({ kind: "parity-conflict", actions: { run: { inputSchema: z.string(), block: noop } },
    resources: { a: coll("[t]/notes", true), b: coll("[t]/events", false) } as never })();
  let execution = "resolved";
  try {
    await createExecutionContext({ orgId: DEFAULT_ORG_ID, flow, actionName: "run", requestId: "req_conflict",
      sessionId: CHILD, userId: "u_1", stores: createInMemoryStores() });
  } catch (e) {
    execution = /conflicting sharedToLineage/.test(String(e)) ? "refuses the flow" : `threw: ${String(e)}`;
  }
  const session = { id: CHILD, userId: "u_1", lineageId: LINEAGE };
  const http = sessionStorageScope(session, sessionKeyScopeId(session, flow.resources, "x/events", undefined));
  console.log(`note    conflicting same-prefix flags: execution ${execution}; http answers ${http}`);
}

if (failures > 0) {
  console.log(`FAIL · ${failures}/${probes} probes disagree`);
  process.exit(1);
}
console.log(`PASS · ${probes}/${probes} probes agree across ${shapes.length} shapes`);
