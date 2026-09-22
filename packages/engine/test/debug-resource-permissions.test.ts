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
  defineProjectedResourceCollection,
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

/**
 * A projected collection: read-only because of what it *is*, not what it says.
 *
 * `ProjectedResourceCollectionConfig` has no `writable` key at all — its own doc
 * comment calls read-only "structural, not a flag", and the registry refuses
 * every mutator on it. So the absent-key rule that is right everywhere else
 * gives the wrong answer here: nothing was declared, but the default is not
 * writable.
 */
const externalPositions = defineProjectedResourceCollection({
  pattern: "positions/*",
  scope: "org",
  stateSchema: z.object({ v: z.string().default("") }),
  read: async () => null,
  search: async () => ({ items: [], nextCursor: null })
});

function buildFlow() {
  const block = handler({
    name: "noop",
    resources: {
      sealed,
      modelClosed,
      plain,
      openToModel,
      sealedCollection,
      externalPositions
    },
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

  it("reports a projected collection as unwritable, though it declares nothing", async () => {
    // THE CASE THE ABSENT-KEY RULE GETS WRONG IF THE SERVER STAYS LITERAL.
    // A projected collection cannot declare `writable` — the field does not
    // exist on its config — and it is refused every mutator by the registry.
    // Reporting "declared nothing" would put it in the same bucket as an
    // ordinary mutable resource and leave a genuinely read-only thing
    // unmarked, which is the false negative the failure taxonomy calls the
    // worse direction.
    //
    // So the field answers "can this be written", not "did somebody type a
    // key". Absent still means writable; it just stops being the only way to
    // say nothing was declared.
    const entry = entryNamed(await listResources(), "externalPositions");

    expect(entry.isCollection).toBe(true);
    expect(entry.writable).toBe(false);
    // `llmWritable` has no analogue here — the config has no such field and no
    // model write tool exists to gate — so it stays absent rather than being
    // invented.
    expect(Object.hasOwn(entry, "llmWritable")).toBe(false);
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
