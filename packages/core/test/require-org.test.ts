/**
 * C6 — the retired organization-requirement declaration (FIX-1442).
 *
 * This file used to prove that `requireOrg` bubbled: a leaf declared it, and
 * the flag surfaced on every composing sequencer and router up to
 * `flow.requiresOrg`, where the HTTP layer read it to decide whether a request
 * needed an organization.
 *
 * Organization identity is unconditional now, so there is nothing left to
 * declare and nothing left to bubble — the whole subsystem is gone. What
 * replaces those tests is the one thing that still matters about it: a flow or
 * block that STILL carries the old flag does not quietly build.
 *
 * That distinction is the point. An ignored `requireOrg` would leave an author
 * believing they had asked for something, on a config the framework no longer
 * reads — which is worse than either keeping the flag or removing it, because
 * nothing says which happened.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler, sequencer } from "../src";

describe("the retired `requireOrg` declaration is refused, not ignored", () => {
  it("refuses a block that still declares requireOrg, and names the migration", () => {
    expect(() =>
      handler({
        name: "needs-org",
        inputSchema: z.object({}),
        outputSchema: z.object({}),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        requireOrg: true,
        execute: () => ({})
      } as any)
    ).toThrow(/requireOrg/);
  });

  it("refuses a flow whose authentication config still declares requireOrg", () => {
    expect(() =>
      defineFlow({
        kind: "legacy-org-flow",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        authentication: { requireOrg: true } as any,
        actions: {
          run: {
            inputSchema: z.object({}),
            block: handler({
              name: "run",
              inputSchema: z.object({}),
              outputSchema: z.object({}),
              execute: () => ({})
            })
          }
        }
      })({ id: "legacy-org-flow" })
    ).toThrow(/requireOrg/);
  });

  it("refuses `requireOrg: false` too — the flag is gone, not defaulted", () => {
    // A `false` reads as "this flow deliberately does not need an org", which
    // is no longer a state that exists. Accepting it because it happens to
    // match the old default would leave that intent silently unread.
    expect(() =>
      defineFlow({
        kind: "legacy-org-flow-false",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        authentication: { requireOrg: false } as any,
        actions: {
          run: {
            inputSchema: z.object({}),
            block: handler({
              name: "run",
              inputSchema: z.object({}),
              outputSchema: z.object({}),
              execute: () => ({})
            })
          }
        }
      })({ id: "legacy-org-flow-false" })
    ).toThrow(/requireOrg/);
  });

  it("builds an ordinary composed flow that declares nothing about organizations", () => {
    // The control. The refusals above must be about the retired flag, not
    // about composition having broken when the bubbling was removed.
    const leaf = handler({
      name: "leaf",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => ({ ok: true })
    });
    const chain = sequencer({ name: "chain" }).step(leaf);

    const flow = defineFlow({
      kind: "plain",
      actions: { run: { inputSchema: z.object({}), block: chain } }
    })({ id: "plain" });

    expect(flow.actions.run.block.name).toBe("chain");
    expect("requiresOrg" in flow).toBe(false);
  });
});
