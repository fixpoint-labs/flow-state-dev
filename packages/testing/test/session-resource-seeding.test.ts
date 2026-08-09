/**
 * Seeded session resources are visible to the code under test (FIX-1000).
 *
 * Session-scoped resource state now addresses through
 * `resolveSessionResourceScopeId(record)`, not the bare session id. Both test
 * harnesses in this package mint a session record *and* seed its resources, so
 * they have to agree with each other about the address: mint a generation but
 * seed at the bare id, and every `seed.session.resources` a user writes goes
 * silently invisible — the flow under test sees the schema default and the
 * assertion fails somewhere far from the cause.
 *
 * That seam is what this file pins, from the outside: seed a resource, read it
 * inside a block, assert the block saw the seeded value. It is deliberately
 * black-box — no address is computed here — because the harness's job is that
 * a user never has to know the address exists.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defineFlow,
  defineResource,
  defineResourceCollection,
  handler
} from "@flow-state-dev/core";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { testBlock, testFlow } from "../src";

const ledger = defineResource({
  scope: "session",
  stateSchema: z.object({ entries: z.array(z.string()).default([]) }),
  writable: true
});

const memos = defineResourceCollection({
  scope: "session",
  pattern: "memos/*",
  stateSchema: z.object({ note: z.string().default("") })
});

/** What the block observed, so the assertions are on the block's view. */
let seen: unknown;

const readLedger = handler({
  name: "read-ledger",
  resources: { ledger },
  execute: async (_input: unknown, ctx: any) => {
    seen = { ...ctx.resources.ledger.state };
    return "ok";
  }
});

const readMemo = handler({
  name: "read-memo",
  resources: { memos },
  execute: async (_input: unknown, ctx: any) => {
    const ref = await ctx.resources.memos.getOptional("a");
    seen = ref === undefined ? null : { ...ref.state };
    return "ok";
  }
});

describe("FIX-1000: seeded session resources reach the code under test", () => {
  it("testBlock — a seeded single resource is readable from the block", async () => {
    seen = undefined;
    const result = await testBlock(readLedger, {
      input: {},
      session: { resources: { ledger: { entries: ["seeded"] } } }
    });

    expect(result.error).toBeNull();
    expect(seen).toEqual({ entries: ["seeded"] });
  });

  it("testFlow — a seeded single resource is readable from the action", async () => {
    seen = undefined;
    const flow = defineFlow({
      kind: "seed-flow",
      actions: { run: { inputSchema: z.object({}).passthrough(), block: readLedger } },
      resources: { ledger }
    } as never)();

    const result = await testFlow({
      flow: flow as never,
      action: "run",
      input: {},
      userId: "test-user",
      seed: { session: { resources: { ledger: { entries: ["seeded"] } } } }
    });

    expect(result.error).toBeUndefined();
    expect(seen).toEqual({ entries: ["seeded"] });
  });

  it("testFlow — a seeded collection instance is readable from the action", async () => {
    // The collection path resolves its address by a different route than the
    // single-resource path, so one can be converted without the other.
    seen = undefined;
    const flow = defineFlow({
      kind: "seed-collection-flow",
      actions: { run: { inputSchema: z.object({}).passthrough(), block: readMemo } },
      resources: { memos }
    } as never)();

    const result = await testFlow({
      flow: flow as never,
      action: "run",
      input: {},
      userId: "test-user",
      seed: { session: { resources: { "memos/a": { note: "seeded" } } } }
    });

    expect(result.error).toBeUndefined();
    expect(seen).toEqual({ note: "seeded" });
  });

  it("testFlow — a resumed session keeps its seeded resources across two runs", async () => {
    // `testFlow` reuses an existing record on a second call against shared
    // stores. If the reseed re-minted instead of reusing the stored generation,
    // the second run would read an empty scope — the session-resume scenario
    // the harness explicitly supports.
    seen = undefined;
    const flow = defineFlow({
      kind: "seed-resume-flow",
      actions: { run: { inputSchema: z.object({}).passthrough(), block: readLedger } },
      resources: { ledger }
    } as never)();

    const stores = createInMemoryStores();

    await testFlow({
      flow: flow as never,
      action: "run",
      input: {},
      stores,
      userId: "test-user",
      sessionId: "resumed",
      seed: { session: { resources: { ledger: { entries: ["seeded"] } } } }
    });
    expect(seen).toEqual({ entries: ["seeded"] });

    seen = undefined;
    await testFlow({
      flow: flow as never,
      action: "run",
      input: {},
      stores,
      userId: "test-user",
      sessionId: "resumed"
    });
    expect(seen).toEqual({ entries: ["seeded"] });
  });
});
