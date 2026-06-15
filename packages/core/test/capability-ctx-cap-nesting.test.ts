/**
 * Runtime `ctx.cap` construction for nested blocks.
 *
 * The build-time merge of `uses: [cap]` into a block's declared resources /
 * state schemas is covered by `capability-block-integration.test.ts`. This
 * file covers the *runtime* half: a block that declares a capability with an
 * `fns` factory must reach its accessors at `ctx.cap.<name>` even when it runs
 * nested inside another block (a sequencer step), not only as the root action.
 *
 * The accessors are built in core's block-run wrapper (`build-block.ts`), so
 * the contract holds regardless of nesting depth and whether or not a server
 * `executeBlock` wrapped the root.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { handler, sequencer } from "../src";
import { defineCapability } from "../src/capability";
import { createMockContext, runForTest } from "./helpers";

describe("ctx.cap on nested blocks", () => {
  it("a nested handler reaches ctx.cap for a capability it declares", async () => {
    const greeter = defineCapability({
      name: "greeter",
      fns: () => ({ greet: (who: string) => `hi ${who}` }),
    });

    // The handler is a sequencer STEP — it runs through core's block-run path,
    // never the server's executeBlock. Before the fix its ctx.cap was empty and
    // `ctx.cap.greeter` would be undefined, so this `greet(...)` call throws.
    const step = handler({
      name: "inner",
      inputSchema: z.string(),
      outputSchema: z.string(),
      uses: [greeter],
      execute: (name, ctx) =>
        (ctx.cap as { greeter: { greet: (w: string) => string } }).greeter.greet(name),
    });

    const seq = sequencer({ name: "outer", inputSchema: z.string() }).step(step);

    const out = await runForTest(seq, "ada", createMockContext());

    expect(out).toBe("hi ada");
  });

  it("an ancestor-built accessor is inherited untouched; a nested block only builds the caps it adds", async () => {
    let sharedBuilds = 0;
    const shared = defineCapability({
      name: "shared",
      fns: () => {
        sharedBuilds += 1;
        return { build: sharedBuilds };
      },
    });
    const extra = defineCapability({
      name: "extra",
      fns: () => ({ tag: "from-extra" }),
    });

    let innerCap: Record<string, unknown> = {};
    const step = handler({
      name: "inner",
      inputSchema: z.any(),
      outputSchema: z.any(),
      // Declares `shared` (also declared by the ancestor) plus its own `extra`.
      uses: [shared, extra],
      execute: (_input, ctx) => {
        innerCap = { ...(ctx.cap as Record<string, unknown>) };
        return "done";
      },
    });

    // The ancestor sequencer declares `shared`, so it builds that accessor
    // first; the nested step then inherits it and adds only `extra`.
    const seq = sequencer({ name: "outer", uses: [shared] }).step(step);

    await runForTest(seq, {}, createMockContext());

    // `shared.fns` ran exactly once — the nested block inherited the ancestor's
    // accessor (skip-by-name) instead of rebuilding it.
    expect(sharedBuilds).toBe(1);
    // The nested block additively built the cap it adds...
    expect(innerCap.extra).toEqual({ tag: "from-extra" });
    // ...while still seeing the inherited accessor (the ancestor's instance).
    expect(innerCap.shared).toEqual({ build: 1 });
  });
});
