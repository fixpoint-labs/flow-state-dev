/**
 * Admission for the detached-dispatch source (FIX-999).
 *
 * The injection seam lets a running request start another request from inside a
 * block. That dispatch has to enter the flow *somewhere*, and the whole security
 * argument for the seam rests on it entering exactly one pre-assembled place —
 * the flow's workstream core — and never a caller-addressed action.
 *
 * The failure this file exists to prevent is a **fall-through**. `resolveActionCore`
 * ends with `return flow.actions[actionName]`, so a source branch that merely
 * *prefers* the workstream core and drops out when it is absent would resolve a
 * public action instead. Because the seam stamps its own source, that is not a
 * caller forging a source — it is the framework handing a detached dispatch a
 * caller-addressed handler. Every "no core" test below therefore runs against a
 * flow that HAS an action matching the dispatched name: with the fall-through
 * intact the test resolves that action and fails, which is the point. A test
 * using an unknown action name would pass either way and prove nothing.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { ActionCore, FlowInstance } from "@flow-state-dev/core/types";
import { resolveActionCore } from "../../src/execution/resolve-action-core";
import { WORKSTREAM_SOURCE } from "../../src/execution/transport-sources";
import { isPublicReentryAllowed } from "../../src/routes/public-reentry";
import { createConcurrencyArbiter } from "../../src/transports/concurrency/arbiter";

const drainBlock = handler({
  name: "drain",
  inputSchema: z.object({ value: z.string().optional() }),
  execute: () => undefined
});

const publicBlock = handler({
  name: "drain",
  inputSchema: z.object({ value: z.string().optional() }),
  execute: () => undefined
});

/**
 * A flow whose PUBLIC action is named "drain" — the same name a detached
 * dispatch carries as provenance. This collision is deliberate: it is what makes
 * a fall-through observable.
 */
function flowWithCollidingAction() {
  return defineFlow({
    kind: "board",
    actions: { drain: { block: publicBlock, concurrency: { policy: "reject", key: "session" } } }
  })({ id: "board" });
}

function withWorkstream(flow: FlowInstance, core: ActionCore): FlowInstance {
  return { ...flow, workstream: core };
}

describe("workstream admission — resolveActionCore", () => {
  it("resolves the workstream core for a detached dispatch", () => {
    const core: ActionCore = { block: drainBlock };
    const flow = withWorkstream(flowWithCollidingAction(), core);
    expect(resolveActionCore(flow, "drain", WORKSTREAM_SOURCE, undefined)).toBe(core);
  });

  it("refuses when the flow has no workstream core, and does NOT fall through to flow.actions", () => {
    // The *off* state — every flow today, until a workstream core is populated.
    const flow = flowWithCollidingAction();
    expect(flow.workstream).toBeUndefined();

    const resolved = resolveActionCore(flow, "drain", WORKSTREAM_SOURCE, undefined);

    // With the terminal branch: undefined, and the caller turns that into a
    // named refusal. With a fall-through: `flow.actions.drain`, i.e. a detached
    // dispatch running a public handler.
    expect(resolved).toBeUndefined();
    expect(resolved).not.toBe(flow.actions.drain);
  });

  it("ignores forged metadata — the branch is keyed on the source alone", () => {
    const flow = flowWithCollidingAction();
    const forged = { webhook: { provider: "stripe", eventType: "invoice.paid" } };
    expect(resolveActionCore(flow, "drain", WORKSTREAM_SOURCE, forged)).toBeUndefined();
  });

  it("leaves every other source's resolution unchanged", () => {
    const core: ActionCore = { block: drainBlock };
    const flow = withWorkstream(flowWithCollidingAction(), core);
    // An ordinary caller dispatch still resolves the public action, not the
    // workstream core — the new branch must not leak in the other direction.
    expect(resolveActionCore(flow, "drain", "http", undefined)).toBe(flow.actions.drain);
  });
});

describe("workstream admission — concurrency", () => {
  it("takes the flow default rather than the same-named public action's policy", () => {
    const core: ActionCore = { block: drainBlock };
    const flow = withWorkstream(flowWithCollidingAction(), core);
    const arbiter = createConcurrencyArbiter();

    // The public action "drain" declares `reject`. A detached dispatch carries
    // "drain" as provenance only; inheriting that policy by name collision would
    // let an unrelated action's back-pressure decide whether detached work runs.
    const decision = arbiter.resolve(flow, "drain", {
      source: WORKSTREAM_SOURCE,
      metadata: undefined,
      sessionId: "s_1",
      userId: "u_1"
    });

    expect(decision.policy).not.toBe("reject");
  });
});

describe("workstream admission — public re-entry", () => {
  it("omits the detached source from the allow-list", () => {
    // retry / continue / resume are public re-dispatch surfaces, and retry
    // accepts a caller-supplied `inputOverride`. A detached request must not be
    // re-enterable through any of them.
    expect(isPublicReentryAllowed(WORKSTREAM_SOURCE)).toBe(false);
  });

  it("still admits today's public sources", () => {
    expect(isPublicReentryAllowed("http")).toBe(true);
    expect(isPublicReentryAllowed("chat")).toBe(true);
    expect(isPublicReentryAllowed("scheduled")).toBe(true);
    expect(isPublicReentryAllowed("mcp")).toBe(true);
  });

  it("keeps refusing webhook, which the deny-list already refused", () => {
    expect(isPublicReentryAllowed("webhook")).toBe(false);
  });

  it("refuses an unrecognized source — the allow-list's whole point", () => {
    // A deny-list admits anything nobody thought to name, which is how this
    // seam's source would have inherited re-entry for free.
    expect(isPublicReentryAllowed("some-third-party-transport")).toBe(false);
    expect(isPublicReentryAllowed("")).toBe(false);
  });
});
