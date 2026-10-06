/**
 * The build-time collision check in `defineFlow` and the engine's write path
 * must agree on which durable cell a resource declaration occupies.
 *
 * `defineFlow` refuses a flow in which two distinct declarations land on one
 * storage cell, because the second would silently overwrite the first's data.
 * That refusal is only worth anything if it reasons about the cells the engine
 * actually writes. Where the two disagree, the check either misses a real
 * collision (two declarations sharing data unnoticed) or rejects a valid flow
 * over a collision that cannot happen.
 *
 * The first block pins down where the engine writes, by writing through a real
 * execution context and reading the store. The second asserts the build-time
 * check keys each declaration the same way.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  DEFAULT_ORG_ID,
  defineFlow,
  defineResource,
  defineResourceCollection,
  handler
} from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { createExecutionContext, createInMemoryStores } from "../src";

const bodySchema = z.object({ body: z.string() });

function flowWith(resources: Record<string, unknown>) {
  const block = handler<Record<string, never>, { ok: boolean }>({
    name: "parity-handler",
    execute: () => ({ ok: true })
  });
  return defineFlow({
    kind: "storage-identity-parity",
    actions: { run: { inputSchema: z.object({}), block } },
    resources: resources as never
  })();
}

/** A collection carrying a `ref`, which collection configs do not declare. */
function collectionWithRef(ref: string, pattern = "files/*") {
  return defineResourceCollection({
    scope: "user",
    pattern,
    stateSchema: bodySchema,
    ref
  } as never);
}

/** A single resource carrying a `pattern`, which `defineResource` preserves. */
function resourceWithPattern(pattern = "files/*") {
  return defineResource({
    scope: "user",
    stateSchema: bodySchema,
    pattern
  } as never);
}

async function contextFor(resources: Record<string, unknown>) {
  const stores = createInMemoryStores();
  const ctx = await createExecutionContext({
    orgId: DEFAULT_ORG_ID,
    flow: flowWith(resources),
    actionName: "run",
    requestId: "req_1",
    sessionId: "sess_1",
    userId: "user_1",
    stores
  });
  return { ctx, stores };
}

describe("where the engine writes a declaration", () => {
  it("files a collection's instances under its pattern and ignores a ref on it", async () => {
    const { ctx, stores } = await contextFor({ notes: collectionWithRef("alpha") });
    const notes = ctx.resources.notes as unknown as ResourceCollectionRef<{ body: string }>;

    await notes.create("x", { body: "hi" });

    expect(await stores.resourceState.get("user", "user_1", "files/x")).toBeDefined();
    expect(await stores.resourceState.get("user", "user_1", "alpha/x")).toBeUndefined();
    expect(await stores.resourceState.get("user", "user_1", "alpha")).toBeUndefined();
  });

  it("routes a defineResource carrying a pattern down the collection branch", async () => {
    const { ctx, stores } = await contextFor({ notes: resourceWithPattern() });
    const notes = ctx.resources.notes as unknown as ResourceCollectionRef<{ body: string }>;

    await notes.create("x", { body: "hi" });

    expect(await stores.resourceState.get("user", "user_1", "files/x")).toBeDefined();
    expect(await stores.resourceState.get("user", "user_1", "notes")).toBeUndefined();
  });
});

describe("defineFlow's collision check keys declarations where the engine writes them", () => {
  it("rejects two collections sharing a pattern, whatever ref each carries", () => {
    // Both write `files/<key>`: the second would overwrite the first's rows.
    expect(() =>
      flowWith({ alpha: collectionWithRef("alpha"), beta: collectionWithRef("beta") })
    ).toThrow(/Resource collision/);
  });

  it("does not file a collection under a ref it carries", () => {
    // The collection writes `files/<key>`, the resource writes `prefs`: disjoint.
    expect(() =>
      flowWith({
        prefs: defineResource({ scope: "user", stateSchema: bodySchema }),
        notes: collectionWithRef("prefs")
      })
    ).not.toThrow();
  });

  it("treats a defineResource carrying a pattern as the collection the engine routes it as", () => {
    // Both write `files/<key>`.
    expect(() =>
      flowWith({
        notes: resourceWithPattern(),
        files: defineResourceCollection({ scope: "user", pattern: "files/*", stateSchema: bodySchema })
      })
    ).toThrow(/Resource collision/);
  });

  it("does not file a defineResource carrying a pattern under its accessor", () => {
    // `notes` writes `files/<key>`; the other resource writes `notes`: disjoint.
    expect(() =>
      flowWith({
        notes: resourceWithPattern(),
        other: defineResource({ scope: "user", stateSchema: bodySchema, ref: "notes" })
      })
    ).not.toThrow();
  });

  it("files an aliased resource only under the slot it persists to", () => {
    // One definition under two accessors persists to ONE slot — its first
    // accessor, `primary`. Nothing is written under `alias`, so a second
    // resource whose ref is `alias` shares no cell with it.
    const shared = defineResource({ scope: "user", stateSchema: bodySchema });
    expect(() =>
      flowWith({
        primary: shared,
        alias: shared,
        other: defineResource({ scope: "user", stateSchema: bodySchema, ref: "alias" })
      })
    ).not.toThrow();
  });

  it("still rejects a resource that lands on an aliased resource's slot", () => {
    const shared = defineResource({ scope: "user", stateSchema: bodySchema });
    expect(() =>
      flowWith({
        primary: shared,
        alias: shared,
        other: defineResource({ scope: "user", stateSchema: bodySchema, ref: "primary" })
      })
    ).toThrow(/Resource collision/);
  });
});
