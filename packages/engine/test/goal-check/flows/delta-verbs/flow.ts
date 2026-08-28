/**
 * FIX-1269 goal check — a real flow, not a unit test.
 *
 * The CI specs drive `createExecutionContext` directly, which proves the
 * mutator contract but nothing about whether the verbs are reachable on the
 * handle the engine actually hands a block. A verb declared on the type but
 * missing from one of the two ref factories, or lost at the package boundary,
 * would leave every one of those specs green. So this runs both verbs on both
 * handle shapes through the full `runAction` path and reports the state back.
 *
 * Not auto-discovered: it sits outside the conventional `flows/` locations, so
 * it runs only when pointed at. From the repo root:
 *
 *   pnpm fsdev run fix1269-goal-check check \
 *     --flow-dir packages/engine/test/goal-check/flows \
 *     -i '{"note":"rate_limited"}' --quiet
 *
 * Pass criteria: the result reports `single` as `{calls:1, errors:["<note>"]}`
 * and `instance` as `{calls:2, errors:["<note>"]}`.
 *
 * If your shell exports `FSDEV_DEFAULT_MODEL` / `FSDEV_INTENT_*`, unset them
 * first: this flow declares no intents (it needs no model), and the resolver
 * rejects a default-model override that could have no effect.
 */
import { defineFlow, defineResource, defineResourceCollection, handler } from "@flow-state-dev/core";
import { z } from "zod";

const tallySchema = z.object({
  calls: z.number().default(0),
  errors: z.array(z.string()).default([])
});

const usage = defineResource({
  scope: "session",
  stateSchema: tallySchema,
  default: { calls: 0, errors: [] }
});

const tallies = defineResourceCollection({
  scope: "session",
  pattern: "tallies/**",
  stateSchema: tallySchema
});

// Provider-free: no generator block, so the run makes no model call and needs
// no API key.
const driveDeltaVerbs = handler({
  name: "drive-delta-verbs",
  inputSchema: z.object({ note: z.string() }),
  resources: { usage, tallies },
  execute: async (input, ctx) => {
    // Ref factory 1 — the single-resource handle.
    await ctx.resources.usage.incState({ calls: 1 });
    await ctx.resources.usage.pushState("errors", input.note);

    // Ref factory 2 — the collection-instance handle. A verb missing from just
    // this one is the failure the CI specs alone could not catch.
    const instance = await ctx.resources.tallies.getOrCreate("t1", {
      calls: 0,
      errors: []
    });
    await instance.incState({ calls: 2 });
    await instance.pushState("errors", input.note);

    return {
      single: ctx.resources.usage.state,
      instance: instance.state
    };
  }
});

const goalCheckFlow = defineFlow({
  kind: "fix1269-goal-check",
  actions: {
    check: { block: driveDeltaVerbs }
  }
});

export default goalCheckFlow({ id: "default" });
