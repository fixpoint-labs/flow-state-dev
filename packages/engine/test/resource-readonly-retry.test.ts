/**
 * FIX-1265: a writable:false refusal is a configuration error. Retrying it
 * re-runs the whole block and replays every side effect already performed.
 *
 * Both halves are required: the refusal is not retried *and* a genuinely
 * retryable failure on the same persist/write path still is. Tests configure
 * maxAttempts > 1 — under the default (no policy / maxAttempts = 1) no retry
 * happens even against the unfixed plain-Error throw.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, defineResource, handler } from "@flow-state-dev/core";
import { z } from "zod";
import type { JsonObject, ResourceConfig } from "@flow-state-dev/core/types";
import {
  FlowError,
  NetworkError,
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
