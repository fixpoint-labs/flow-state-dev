/**
 * FIX-1265: a writable:false refusal is a configuration error. Retrying it
 * re-runs the whole block and replays every side effect already performed.
 *
 * FIX-1519: a resource collection's writable:false refusal is the same
 * refusal, so it carries the same FlowError (`resource_read_only`,
 * non-retryable) as a single resource's, on every path it refuses.
 *
 * Both halves are required: the refusal is not retried *and* a genuinely
 * retryable failure on the same persist/write path still is. Tests configure
 * maxAttempts > 1 — under the default (no policy / maxAttempts = 1) no retry
 * happens even against the unfixed plain-Error throw.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import {
  defineFlow,
  defineResource,
  defineResourceCollection,
  handler
} from "@flow-state-dev/core";
import { z } from "zod";
import type {
  JsonObject,
  ResourceCollectionConfig,
  ResourceConfig
} from "@flow-state-dev/core/types";
import {
  FlowError,
  NetworkError,
  ResourceAlreadyExistsError,
  createInMemoryStores,
  isRetryableError,
  retryWithPolicy,
  runAction
} from "../src";
import { createScopeResourceRegistry } from "../src/context/resource-registry";

const RETRY_POLICY = {
  maxAttempts: 3,
  baseDelayMs: 0,
  maxDelayMs: 0
} as const;

function makeResourceConfig(overrides: Partial<ResourceConfig> = {}): ResourceConfig {
  return {
    scope: "session",
    stateSchema: z.object({}).passthrough(),
    ...overrides
  };
}

function makeWritableRegistry(options: {
  configs: Record<string, ResourceConfig>;
  mutateResourceKey?: (
    key: string,
    mutator: (current: JsonObject) => JsonObject | Promise<JsonObject>
  ) => Promise<{ committed: boolean; previousState: JsonObject }>;
  persistResourceContentKey?: (key: string, value: string) => Promise<void>;
}) {
  const state: Record<string, JsonObject> = {};
  for (const key of Object.keys(options.configs)) {
    state[key] = {};
  }
  const content: Record<string, string> = {};

  return createScopeResourceRegistry({
    scope: "session",
    scopeId: "sess_readonly_retry",
    cellOf: () => "sess_readonly_retry",
    configs: options.configs,
    readResources: () => state,
    readResourceContent: () => content,
    mutateResourceKey:
      options.mutateResourceKey ??
      (async (key, mutator) => {
        const previous = state[key] ?? {};
        state[key] = await mutator(previous);
        return { committed: true, previousState: previous };
      }),
    deleteResourceKey: async () => false,
    persistResourceContentKey:
      options.persistResourceContentKey ??
      (async (key, value) => {
        content[key] = value;
      }),
    deleteResourceContentKey: async (key) => {
      delete content[key];
    }
  });
}

describe("writable:false refusals are not retried (FIX-1265)", () => {
  it("does not retry a read-only state write, and the refusal is a non-retryable FlowError", async () => {
    const registry = makeWritableRegistry({
      configs: { doc: makeResourceConfig({ writable: false }) }
    });
    const ref = registry.get("doc");

    let attempts = 0;
    let thrown: unknown;
    try {
      await retryWithPolicy(async () => {
        attempts += 1;
        await ref.patchState({ x: 1 });
      }, RETRY_POLICY);
    } catch (err) {
      thrown = err;
    }

    expect(attempts).toBe(1);
    expect(thrown).toBeInstanceOf(FlowError);
    expect((thrown as FlowError).retryable).toBe(false);
    expect(isRetryableError(thrown as Error, RETRY_POLICY)).toBe(false);
  });

  it("still retries a transient persist failure on the state-write path", async () => {
    let persistCalls = 0;
    const registry = makeWritableRegistry({
      configs: { doc: makeResourceConfig() },
      mutateResourceKey: async () => {
        persistCalls += 1;
        if (persistCalls < 2) {
          throw new NetworkError("store blip");
        }
        return { committed: true, previousState: {} };
      }
    });

    await retryWithPolicy(async () => {
      await registry.get("doc").patchState({ x: 1 });
    }, RETRY_POLICY);

    expect(persistCalls).toBe(2);
  });

  it("does not retry a read-only content write, and the refusal is a non-retryable FlowError", async () => {
    const registry = makeWritableRegistry({
      configs: { doc: makeResourceConfig({ writable: false }) }
    });
    const ref = registry.get("doc");

    let attempts = 0;
    let thrown: unknown;
    try {
      await retryWithPolicy(async () => {
        attempts += 1;
        await ref.writeContent("nope");
      }, RETRY_POLICY);
    } catch (err) {
      thrown = err;
    }

    expect(attempts).toBe(1);
    expect(thrown).toBeInstanceOf(FlowError);
    expect((thrown as FlowError).retryable).toBe(false);
    expect(isRetryableError(thrown as Error, RETRY_POLICY)).toBe(false);
  });

  it("still retries a transient persist failure on the content-write path", async () => {
    let persistCalls = 0;
    const registry = makeWritableRegistry({
      configs: { doc: makeResourceConfig() },
      persistResourceContentKey: async () => {
        persistCalls += 1;
        if (persistCalls < 2) {
          throw new NetworkError("store blip");
        }
      }
    });

    await retryWithPolicy(async () => {
      await registry.get("doc").writeContent("ok");
    }, RETRY_POLICY);

    expect(persistCalls).toBe(2);
  });

  it("does not re-execute a retry-configured block that hits a read-only state write", async () => {
    let attempts = 0;
    const flow = defineFlow({
      kind: "readonly-state-retry-flow",
      actions: {
        run: {
          inputSchema: z.object({}),
          block: handler({
            name: "write-readonly-state",
            inputSchema: z.object({}),
            outputSchema: z.object({ ok: z.boolean() }),
            retry: { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 },
            execute: async (_input, ctx) => {
              attempts += 1;
              await ctx.resources.doc.patchState({ x: 1 });
              return { ok: true };
            }
          })
        }
      },
      resources: {
        doc: defineResource({
          scope: "session",
          stateSchema: z.object({ x: z.number().optional() }),
          writable: false
        })
      }
    })();

    const result = await runAction({
    orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      input: {},
      userId: "user_readonly_state_retry",
      sessionId: "sess_readonly_state_retry",
      stores: createInMemoryStores(),
      runtimeConfig: {}
    });

    expect(attempts).toBe(1);
    expect(result.error).toBeInstanceOf(FlowError);
    expect(result.error?.retryable).toBe(false);
  });

  it("does not re-execute a retry-configured block that hits a read-only content write", async () => {
    let attempts = 0;
    const flow = defineFlow({
      kind: "readonly-content-retry-flow",
      actions: {
        run: {
          inputSchema: z.object({}),
          block: handler({
            name: "write-readonly-content",
            inputSchema: z.object({}),
            outputSchema: z.object({ ok: z.boolean() }),
            retry: { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 },
            execute: async (_input, ctx) => {
              attempts += 1;
              await ctx.resources.doc.writeContent("nope");
              return { ok: true };
            }
          })
        }
      },
      resources: {
        doc: defineResource({
          scope: "session",
          stateSchema: z.object({}),
          content: "original",
          writable: false
        })
      }
    })();

    const result = await runAction({
    orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      input: {},
      userId: "user_readonly_content_retry",
      sessionId: "sess_readonly_content_retry",
      stores: createInMemoryStores(),
      runtimeConfig: {}
    });

    expect(attempts).toBe(1);
    expect(result.error).toBeInstanceOf(FlowError);
    expect(result.error?.retryable).toBe(false);
  });
});

function makeReadOnlyCollectionRegistry(initialState: Record<string, JsonObject>) {
  const state: Record<string, JsonObject> = { ...initialState };
  const content: Record<string, string> = {};
  const items: ResourceCollectionConfig = {
    pattern: "items/*",
    scope: "session",
    stateSchema: z.object({ v: z.number() }).passthrough(),
    writable: false
  };

  const registry = createScopeResourceRegistry({
    scope: "session",
    scopeId: "sess_readonly_collection",
    cellOf: () => "sess_readonly_collection",
    configs: { items },
    readResources: () => state,
    readResourceContent: () => content,
    // Honors create-if-absent the way the real CAS does: a `create` intent
    // against a live row loses with ResourceAlreadyExistsError.
    mutateResourceKey: async (key, mutator, opts) => {
      const previous = state[key];
      if (opts?.intent === "create" && previous !== undefined) {
        throw new ResourceAlreadyExistsError(key, { value: previous, version: 1 });
      }
      state[key] = await mutator(previous ?? {});
      return { committed: true, previousState: previous ?? {} };
    },
    deleteResourceKey: async (key) => {
      const existed = key in state;
      delete state[key];
      return existed;
    },
    persistResourceContentKey: async (key, value) => {
      content[key] = value;
    },
    deleteResourceContentKey: async (key) => {
      delete content[key];
    }
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { collection: (registry as any).items, state, content };
}

/**
 * Runs `op` under a retry policy and returns what it threw plus how many
 * attempts ran — the observable a retry-configured block would see.
 */
async function refusalUnderRetry(op: () => Promise<unknown>) {
  let attempts = 0;
  let thrown: unknown;
  try {
    await retryWithPolicy(async () => {
      attempts += 1;
      await op();
    }, RETRY_POLICY);
  } catch (err) {
    thrown = err;
  }
  return { attempts, thrown };
}

function expectReadOnlyRefusal(
  outcome: { attempts: number; thrown: unknown },
  message: string
) {
  // Same shape as the single-resource refusal above: one attempt, a FlowError
  // with the resource_read_only code, and the message callers match on.
  expect(outcome.attempts).toBe(1);
  expect(outcome.thrown).toBeInstanceOf(FlowError);
  const err = outcome.thrown as FlowError;
  expect(err.code).toBe("resource_read_only");
  expect(err.retryable).toBe(false);
  expect(err.message).toBe(message);
  expect(isRetryableError(err, RETRY_POLICY)).toBe(false);
}

describe("collection writable:false refusals match the single-resource refusal (FIX-1519)", () => {
  it("single-resource refusal carries resource_read_only (the shape collections must match)", async () => {
    const registry = makeWritableRegistry({
      configs: { doc: makeResourceConfig({ writable: false }) }
    });
    expectReadOnlyRefusal(
      await refusalUnderRetry(() => registry.get("doc").patchState({ x: 1 })),
      'Resource "doc" is read-only'
    );
  });

  it("refuses an instance state write with a non-retryable FlowError", async () => {
    const { collection, state } = makeReadOnlyCollectionRegistry({ "items/doc1": { v: 1 } });
    const ref = await collection.get("doc1");
    expectReadOnlyRefusal(
      await refusalUnderRetry(() => ref.patchState({ v: 2 })),
      'Resource "items/doc1" is read-only'
    );
    expect(state["items/doc1"]).toEqual({ v: 1 });
  });

  it("refuses an instance content write with a non-retryable FlowError", async () => {
    const { collection, content } = makeReadOnlyCollectionRegistry({ "items/doc1": { v: 1 } });
    const ref = await collection.get("doc1");
    expectReadOnlyRefusal(
      await refusalUnderRetry(() => ref.writeContent("nope")),
      'Resource "items/doc1" content is read-only'
    );
    expect(content["items/doc1"]).toBeUndefined();
  });

  it("refuses create({ replace: true }) over a live instance with a non-retryable FlowError", async () => {
    const { collection, state } = makeReadOnlyCollectionRegistry({ "items/doc1": { v: 1 } });
    expectReadOnlyRefusal(
      await refusalUnderRetry(() => collection.create("doc1", { v: 42 }, { replace: true })),
      'Resource "items/doc1" is read-only'
    );
    expect(state["items/doc1"]).toEqual({ v: 1 });
  });

  it("refuses delete with a non-retryable FlowError", async () => {
    const { collection, state } = makeReadOnlyCollectionRegistry({ "items/doc1": { v: 1 } });
    expectReadOnlyRefusal(
      await refusalUnderRetry(() => collection.delete("doc1")),
      'Resource "items/doc1" is read-only'
    );
    expect(state["items/doc1"]).toEqual({ v: 1 });
  });

  it("does not re-execute a retry-configured block that hits a read-only collection write", async () => {
    let attempts = 0;
    const flow = defineFlow({
      kind: "readonly-collection-retry-flow",
      actions: {
        run: {
          inputSchema: z.object({}),
          block: handler({
            name: "write-readonly-collection",
            inputSchema: z.object({}),
            outputSchema: z.object({ ok: z.boolean() }),
            retry: { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 },
            execute: async (_input, ctx) => {
              attempts += 1;
              // Creating a new key stays open on a read-only collection;
              // overwriting the instance it just made is the refused write.
              const doc = await ctx.resources.items.getOrCreate("doc1", { v: 1 });
              await doc.patchState({ v: 2 });
              return { ok: true };
            }
          })
        }
      },
      resources: {
        items: defineResourceCollection({
          scope: "session",
          pattern: "items/*",
          stateSchema: z.object({ v: z.number() }),
          writable: false
        })
      }
    })();

    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      input: {},
      userId: "user_readonly_collection_retry",
      sessionId: "sess_readonly_collection_retry",
      stores: createInMemoryStores(),
      runtimeConfig: {}
    });

    expect(attempts).toBe(1);
    expect(result.error).toBeInstanceOf(FlowError);
    expect(result.error?.code).toBe("resource_read_only");
    expect(result.error?.retryable).toBe(false);
  });
});
