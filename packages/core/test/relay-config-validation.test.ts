/**
 * Registration-time validation for the per-flow `relay` config (FIX-1230).
 * A relay binding is an action in relay form: it carries the handler `block`
 * inline plus the message mapping. Covers `validateRelayConfig` directly and
 * through `defineFlow`, the definition-only rejection at instance construction,
 * and `defineRelayBinding` passthrough.
 *
 * The `durable: true` refusal is the security-relevant case: a relay request is
 * stamped with a source that is never publicly re-enterable, so a suspended
 * relay delivery could never be resumed. This file pins the DECLARED half only
 * — a handler calling `ctx.suspend()` without declaring `durable` is invisible
 * to any construction-time check and belongs to the runtime suspend guard.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "../src";
import {
  defineRelayBinding,
  validateRelayConfig,
  type RelayConfig
} from "../src/types/relay";

const answer = handler({
  name: "answer",
  inputSchema: z.object({ text: z.string() }),
  execute: () => undefined
});

const ok: RelayConfig = {
  on: { question: { block: answer, input: (m) => m.payload } }
};

describe("validateRelayConfig", () => {
  it("is a no-op when relay is absent", () => {
    expect(() => validateRelayConfig(undefined, "conductor")).not.toThrow();
  });

  it("accepts a binding carrying a block and an input mapper", () => {
    expect(() => validateRelayConfig(ok, "conductor")).not.toThrow();
  });

  it("rejects a relay declaration with no `on` map", () => {
    expect(() => validateRelayConfig({} as RelayConfig, "conductor")).toThrow(
      /without an "on" map/
    );
  });

  it("rejects a binding with no input mapper, naming the kind", () => {
    const bad = { on: { question: { block: answer } } } as unknown as RelayConfig;
    expect(() => validateRelayConfig(bad, "conductor")).toThrow(/"question" has no "input"/);
  });

  it("rejects an empty binding, naming the kind", () => {
    const bad = { on: { question: undefined } } as unknown as RelayConfig;
    expect(() => validateRelayConfig(bad, "conductor")).toThrow(/"question" is empty/);
  });

  // The one that matters. Asserted on the reason, not just the throw: the
  // message is what tells an author why their flow will not build.
  it("rejects a binding declaring durable: true, by name and with the reason", () => {
    const durable: RelayConfig = {
      on: { question: { block: answer, durable: true, input: (m) => m.payload } }
    };
    expect(() => validateRelayConfig(durable, "conductor")).toThrow(
      /"question" declares durable: true/
    );
    expect(() => validateRelayConfig(durable, "conductor")).toThrow(
      /never publicly re-enterable/
    );
  });

  // Proves the refusal is on `durable === true` specifically, not on the key
  // being present — an author who writes `durable: false` is not refused.
  it("accepts durable: false", () => {
    const notDurable: RelayConfig = {
      on: { question: { block: answer, durable: false, input: (m) => m.payload } }
    };
    expect(() => validateRelayConfig(notDurable, "conductor")).not.toThrow();
  });
});

describe("defineFlow relay wiring", () => {
  it("accepts a declared relay group and carries it onto the instance", () => {
    const flow = defineFlow({
      kind: "conductor",
      actions: {},
      relay: ok
    })({ id: "conductor" });
    expect(flow.relay?.on.question).toBeDefined();
  });

  it("runs relay validation through defineFlow, so a durable binding never builds", () => {
    expect(() =>
      defineFlow({
        kind: "conductor",
        actions: {},
        relay: { on: { question: { block: answer, durable: true, input: (m) => m.payload } } }
      })({ id: "conductor" })
    ).toThrow(/declares durable: true/);
  });

  it("rejects relay as an instance option — it is definition-only", () => {
    expect(() =>
      defineFlow({ kind: "conductor", actions: {} })({
        id: "conductor",
        relay: ok
      } as unknown as { id: string })
    ).toThrow(/"relay", which is not an instance option/);
  });
});

describe("defineRelayBinding", () => {
  it("returns the binding unchanged, narrowing only the mapper's payload type", () => {
    const binding = defineRelayBinding<{ text: string }>({
      block: answer,
      input: (m) => ({ text: m.payload.text })
    });
    expect(binding.block).toBe(answer);
    expect(binding.input({ kind: "question", from: "sess_a", payload: { text: "hi" } })).toEqual({
      text: "hi"
    });
  });
});
