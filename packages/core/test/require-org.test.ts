/**
 * FIX-428: tests for `requireOrg` block-flag bubbling.
 *
 * `requireOrg` is opt-in per block: a leaf block declares it, and the flag
 * bubbles up through every sequencer / capability / flow that contains the
 * block. The HTTP action route consults the resulting `flow.requiresOrg` to
 * reject requests against unbound sessions.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler, router, sequencer } from "../src";

const noopSchema = z.object({ value: z.string() });

describe("requireOrg bubbling", () => {
  it("a leaf handler with requireOrg sets requiresOrg on the action's block and the flow", () => {
    const block = handler({
      name: "needs-org",
      inputSchema: noopSchema,
      outputSchema: z.object({ ok: z.boolean() }),
      requireOrg: true,
      execute: () => ({ ok: true })
    });

    expect(block.requiresOrg).toBe(true);

    const flow = defineFlow({
      kind: "needs-org-flow",
      actions: { run: { inputSchema: noopSchema, block } }
    })();

    expect(flow.requiresOrg).toBe(true);
  });

  it("a sequencer with one child requiring org bubbles the flag", () => {
    const orgChild = handler({
      name: "child-needs-org",
      inputSchema: noopSchema,
      outputSchema: noopSchema,
      requireOrg: true,
      execute: (input) => input
    });

    const noOrgChild = handler({
      name: "child-no-org",
      inputSchema: noopSchema,
      outputSchema: noopSchema,
      execute: (input) => input
    });

    const seq = sequencer({ name: "mixed-seq" })
      .then(noOrgChild)
      .then(orgChild);

    expect(seq.requiresOrg).toBe(true);

    const flow = defineFlow({
      kind: "mixed-seq-flow",
      actions: { run: { inputSchema: noopSchema, block: seq } }
    })();
    expect(flow.requiresOrg).toBe(true);
  });

  it("a deeply nested sequencer bubbles requireOrg up through every level", () => {
    const inner = handler({
      name: "deeply-nested",
      inputSchema: noopSchema,
      outputSchema: noopSchema,
      requireOrg: true,
      execute: (input) => input
    });

    const middle = sequencer({ name: "middle-seq" }).then(inner);
    const outer = sequencer({ name: "outer-seq" }).then(middle);

    expect(middle.requiresOrg).toBe(true);
    expect(outer.requiresOrg).toBe(true);
  });

  it("a flow with no requiring blocks reports requiresOrg=false", () => {
    const block = handler({
      name: "plain",
      inputSchema: noopSchema,
      outputSchema: noopSchema,
      execute: (input) => input
    });

    const flow = defineFlow({
      kind: "plain-flow",
      actions: { run: { inputSchema: noopSchema, block } }
    })();

    expect(flow.requiresOrg).toBe(false);
  });

  it("a sequencer where a sequencer-level requireOrg propagates to children-only chains", () => {
    const block = handler({
      name: "leaf",
      inputSchema: noopSchema,
      outputSchema: noopSchema,
      execute: (input) => input
    });

    // Sequencer-level requireOrg: not currently supported via SequencerConfig
    // (no top-level field), but the bubble works through any block author who
    // composes a single requireOrg leaf. Assert that the absence of any
    // requireOrg leaf yields false.
    const seq = sequencer({ name: "no-req" }).then(block);
    expect(seq.requiresOrg).toBe(false);
  });

  it("multi-action flow: any action requiring org sets flow.requiresOrg", () => {
    const orgBlock = handler({
      name: "org-action",
      inputSchema: noopSchema,
      outputSchema: noopSchema,
      requireOrg: true,
      execute: (input) => input
    });

    const noOrgBlock = handler({
      name: "no-org-action",
      inputSchema: noopSchema,
      outputSchema: noopSchema,
      execute: (input) => input
    });

    const flow = defineFlow({
      kind: "multi-action",
      actions: {
        a: { inputSchema: noopSchema, block: noOrgBlock },
        b: { inputSchema: noopSchema, block: orgBlock }
      }
    })();

    expect(flow.requiresOrg).toBe(true);
  });

  it("a router bubbles requireOrg from any of its route blocks", () => {
    const orgRoute = handler({
      name: "org-route",
      inputSchema: noopSchema,
      outputSchema: noopSchema,
      requireOrg: true,
      execute: (input) => input,
    });

    const plainRoute = handler({
      name: "plain-route",
      inputSchema: noopSchema,
      outputSchema: noopSchema,
      execute: (input) => input,
    });

    const r = router({
      name: "org-router",
      inputSchema: noopSchema,
      outputSchema: noopSchema,
      routes: [plainRoute, orgRoute],
      execute: () => orgRoute,
    });

    expect(r.requiresOrg).toBe(true);

    const flow = defineFlow({
      kind: "router-flow",
      actions: { run: { inputSchema: noopSchema, block: r } },
    })();
    expect(flow.requiresOrg).toBe(true);
  });

  it("a router with no route requiring org reports requiresOrg=false", () => {
    const a = handler({
      name: "a",
      inputSchema: noopSchema,
      outputSchema: noopSchema,
      execute: (input) => input,
    });
    const b = handler({
      name: "b",
      inputSchema: noopSchema,
      outputSchema: noopSchema,
      execute: (input) => input,
    });

    const r = router({
      name: "plain-router",
      inputSchema: noopSchema,
      outputSchema: noopSchema,
      routes: [a, b],
      execute: () => a,
    });

    expect(r.requiresOrg).toBe(false);
  });
});
