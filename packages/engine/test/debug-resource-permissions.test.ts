/**
 * The two permission settings on the debug resource snapshot (FIX-1481, V2).
 *
 * The DevTool's Resources panel marks a resource read-only, and the mark has
 * to come from what the store itself refuses a write on — `writable === false`
 * (`resource-registry.ts`, `resource_read_only`). Nothing on the snapshot said
 * anything about writability, so both settings are added here.
 *
 * **The key is omitted when the author declared nothing.** `writable` defaults
 * to allowing the write, so a `false` written where nothing was declared is the
 * one way to get the mark backwards and put a read-only badge on a document
 * anybody can edit (BR-12, BP-030). Absence is asserted on the KEY, with
 * `Object.hasOwn`, because an entry carrying `writable: undefined` serializes
 * to the same JSON and would let that distinction rot silently.
 *
 * Built through the real handler on a real flow, not a hand-made entry.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defineFlow,
  defineResource,
  defineResourceCollection,
  handler
} from "@flow-state-dev/core";
import { createInMemoryStores, createFlowRegistry } from "../src";
import type { SessionRecord } from "../src/stores/types";
import {
  handleDebugListResources,
  resolveDebugConfig
} from "../src/routes/debug-routes";
import type { DebugResourceEntry } from "../src/routes/debug-snapshot";

/** Sealed on both doors — how a `references/` document is minted. */
const sealed = defineResource({
  scope: "org",
  stateSchema: z.object({ v: z.string().default("") }),
  writable: false,
  llmWritable: false
});

/**
 * Writable by code, not offered to a model. The ordinary state of most of the
 * tree, and the case a `!mayWrite` predicate would wrongly mark (BR-13).
 */
const modelClosed = defineResource({
  scope: "org",
  stateSchema: z.object({ v: z.string().default("") }),
  llmWritable: false
});

/** Neither setting declared — the framework default, which is writable. */
const plain = defineResource({
  scope: "org",
  stateSchema: z.object({ v: z.string().default("") })
});

/** Offered to a model, and writable by code by default. */
const openToModel = defineResource({
  scope: "org",
  stateSchema: z.object({ v: z.string().default("") }),
  llmWritable: true
});

/** A sealed collection: the settings live on the collection's own config. */
const sealedCollection = defineResourceCollection({
  pattern: "handbook/[topic]",
  scope: "org",
  stateSchema: z.object({ v: z.string().optional() }),
  writable: false,
  llmWritable: false
});

function buildFlow() {
  const block = handler({
    name: "noop",
    resources: { sealed, modelClosed, plain, openToModel, sealedCollection },
    execute: () => "ok"
  });
  return defineFlow({
    kind: "permissions-flow",
    actions: { run: { inputSchema: z.string(), block } }
  })();
}

async function listResources(): Promise<DebugResourceEntry[]> {
  const stores = createInMemoryStores();
  const registry = createFlowRegistry();
  registry.register(buildFlow());
  const sessionId = "sess_perm";
  const session: SessionRecord = {
    id: sessionId,
    flowKind: "permissions-flow",
    userId: "user_1",
    state: {},
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  await stores.session.set(sessionId, session, "any");

  const res = await handleDebugListResources(
    new Request(`http://localhost/api/flows/sessions/${sessionId}/debug/resources`),
    { kind: "debug_list_resources", sessionId },
    {
      registry,
      stores,
      debug: resolveDebugConfig({ debugEndpointsEnabled: true })
    } as never
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { resources: DebugResourceEntry[] };
  return body.resources;
}

function entryNamed(entries: DebugResourceEntry[], name: string): DebugResourceEntry {
  const found = entries.find((entry) => entry.primaryName === name);
  expect(found, `no entry named ${name}`).toBeDefined();
  return found!;
}

describe("the debug snapshot carries both permission settings", () => {
  it("reports a sealed resource's two settings", async () => {
    const entry = entryNamed(await listResources(), "sealed");

    expect(entry.writable).toBe(false);
    expect(entry.llmWritable).toBe(false);
  });

  it("reports them separately — one declared does not summon the other", async () => {
    // The pair is two questions, not one verdict. Collapsing them would lose
    // the state this entry is in: writable by code, closed to the model.
    const entry = entryNamed(await listResources(), "modelClosed");

    expect(entry.llmWritable).toBe(false);
    expect(Object.hasOwn(entry, "writable")).toBe(false);
  });

  it("BR-12 · carries NEITHER key when the author declared neither", async () => {
    // The rule that keeps the mark from going backwards. A `false` here would
    // badge a resource anybody can edit as read-only.
    const entry = entryNamed(await listResources(), "plain");

    expect(Object.hasOwn(entry, "writable")).toBe(false);
    expect(Object.hasOwn(entry, "llmWritable")).toBe(false);
  });

  it("reports a resource offered to a model as such, and says nothing about code writes", async () => {
    const entry = entryNamed(await listResources(), "openToModel");

    expect(entry.llmWritable).toBe(true);
    expect(Object.hasOwn(entry, "writable")).toBe(false);
  });

  it("BR-14 · puts a sealed collection's settings on the collection entry", async () => {
    const entry = entryNamed(await listResources(), "sealedCollection");

    expect(entry.isCollection).toBe(true);
    expect(entry.writable).toBe(false);
    expect(entry.llmWritable).toBe(false);
  });

  it("changes nothing else about an entry", async () => {
    // The settings are added beside what was already there (BR-16 at the wire
    // altitude): scope, the client-config snapshot and the rest are untouched.
    const entry = entryNamed(await listResources(), "plain");

    expect(entry.scope).toBe("org");
    expect(entry.isCollection).toBe(false);
    expect(entry.clientConfig).toEqual({
      hasClient: false,
      data: false,
      stateRead: false,
      contentRead: false,
      prefetchWindow: null
    });
  });
});
