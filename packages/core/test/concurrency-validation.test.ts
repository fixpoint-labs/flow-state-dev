/**
 * Definition-time validation for the per-action / per-flow `concurrency`
 * config (FIX-837). The concurrency policy generalizes the scheduled
 * `onOverlap` idiom; like that surface, v1 rejects reserved policy names
 * (`debounce`, `restart`) and unknown values at definition time so authors
 * see one clear error at registration rather than a silent no-op at runtime.
 * Covers `validateConcurrencyConfig` directly and through `defineFlow`.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "../src";
import { validateConcurrencyConfig, type ConcurrencyConfig } from "../src/types/concurrency";

const noopHandler = handler({
  name: "noop",
  inputSchema: z.object({ value: z.string().optional() }),
  execute: () => undefined
});

describe("validateConcurrencyConfig", () => {
  it("is a no-op when config is absent (default allow applies)", () => {
    expect(() => validateConcurrencyConfig("flow x action y", undefined)).not.toThrow();
  });

  it.each(["allow", "queue", "reject"] as const)("accepts the v1 policy %s (string form)", (policy) => {
    expect(() => validateConcurrencyConfig("flow x action y", policy)).not.toThrow();
  });

  it.each(["allow", "queue", "reject"] as const)("accepts the v1 policy %s (object form)", (policy) => {
    expect(() => validateConcurrencyConfig("flow x action y", { policy })).not.toThrow();
  });

  it.each(["session", "user", "none"] as const)("accepts the preset key %s", (key) => {
    expect(() =>
      validateConcurrencyConfig("flow x action y", { policy: "queue", key })
    ).not.toThrow();
  });

  it("accepts a custom key function", () => {
    expect(() =>
      validateConcurrencyConfig("flow x action y", {
        policy: "reject",
        key: (ctx) => ctx.sessionId
      })
    ).not.toThrow();
  });

  it.each(["debounce", "restart"] as const)("rejects the reserved policy %s as not-implemented", (policy) => {
    expect(() =>
      validateConcurrencyConfig("flow x action y", policy as unknown as ConcurrencyConfig)
    ).toThrow(/reserved but not/);
  });

  it("rejects an unknown policy name", () => {
    expect(() =>
      validateConcurrencyConfig("flow x action y", "switch" as unknown as ConcurrencyConfig)
    ).toThrow(/unsupported concurrency policy/);
  });

  it("rejects an unsupported key", () => {
    expect(() =>
      validateConcurrencyConfig("flow x action y", {
        policy: "queue",
        key: "schedule" as unknown as "session"
      })
    ).toThrow(/unsupported concurrency key/);
  });
});

describe("defineFlow concurrency validation", () => {
  it("accepts valid per-action and flow-default policies", () => {
    expect(() =>
      defineFlow({
        kind: "chat",
        request: { concurrency: "queue" },
        actions: {
          respond: { block: noopHandler },
          sync: { block: noopHandler, concurrency: { policy: "reject", key: "user" } }
        }
      })
    ).not.toThrow();
  });

  it("rejects a reserved policy on an action at definition time", () => {
    expect(() =>
      defineFlow({
        kind: "chat",
        actions: {
          respond: { block: noopHandler, concurrency: "debounce" as unknown as ConcurrencyConfig }
        }
      })
    ).toThrow(/action "respond".*reserved but not/s);
  });

  it("rejects a reserved policy on the flow request default", () => {
    expect(() =>
      defineFlow({
        kind: "chat",
        request: { concurrency: "restart" as unknown as ConcurrencyConfig },
        actions: { respond: { block: noopHandler } }
      })
    ).toThrow(/request default.*reserved but not/s);
  });
});
