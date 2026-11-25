/**
 * Hiring and firing from a conversation: `hire` and `fire`, the roster
 * flow's own `hire` and `fire` blocks (`hire-blocks.ts`) as a worker's tools.
 *
 * They write the roster of the user talking to the worker, through the same
 * blocks the user's own Hire form and Fire button run, so a hire is checked
 * exactly as the form's is (the flow's schema, a key-shaped value, the app's
 * listed models) and shows on the roster at once. What the tools add in front
 * of the write:
 *
 * - **Only on the user's own turn.** A turn a delivered event, a worker's
 *   message, a routine or a task started can't hire or fire: text read there
 *   could ask for one, and nobody could answer an approval there. The same
 *   mark gates the standing-rule tools.
 * - **Checks first.** Every check the write makes, and an id already on the
 *   roster (or one not there, for a fire), refuses with the reason.
 * - **A hire lands at once**: the user's own message asked for it, and a
 *   worker is easily fired.
 * - **A fire waits for the user's approval**, a stock `user_approval`, since
 *   it can't be taken back. Reject throws out of the tool before the write.
 *   Without durable execution there is nobody to ask, so it refuses.
 *
 * Its one preset, `tools`, carries both. It is on, so a worker whose
 * `tools:` line names `hire` or `fire` gets it, and a worker with no line gets
 * it only by picking it in its own file:
 *
 * ```yaml
 * capabilities:
 *   hireWorkers: [tools]
 * ```
 */
import { defineCapability, handler, sequencer } from "@flow-state-dev/core";
import type { BlockContext, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { z } from "zod";
import { isUserTurn } from "../standing-rules/user-turn";
import { createWorkerHireBlocks, checkedHire, type HireChecks, type HireInput } from "./hire-blocks";
import type { WorkerInstallation } from "./installation";
import { WORKERS_RESOURCE } from "./keys";

/** The capability's name, as a worker file names it. */
const HIRE_WORKERS_CAPABILITY = "hireWorkers";

/** The roster of the user this turn runs for. */
function rosterOf(ctx: BlockContext): ResourceCollectionRef {
  return (ctx.resources as Record<string, unknown>)[WORKERS_RESOURCE] as ResourceCollectionRef;
}

/** Refuse unless the user's own message started this turn. */
function refuseUnasked(ctx: BlockContext, verb: string): void {
  if (!isUserTurn(ctx)) {
    throw new Error(`A worker is ${verb} only on a turn the user's own message started; this one can't. Nothing was written.`);
  }
}

/**
 * `hire` and `fire` over `installation`, as the capability `hireWorkers`.
 * `checks` is what the roster's own hire is checked against: pass the app's
 * `hire` config, the same the kit gives the roster flow.
 */
export function hireWorkersCapability(installation: WorkerInstallation, checks: HireChecks = {}) {
  const blocks = createWorkerHireBlocks(installation, checks);

  // Every check the write makes, before it: a refusal names the reason, and nothing is written.
  const checkHire = handler({
    name: "workforce-hire-check",
    inputSchema: blocks.hire.inputSchema,
    outputSchema: z.void(),
    resources: { ...installation.resources },
    execute: async (input: HireInput, ctx: BlockContext) => {
      refuseUnasked(ctx, "hired");
      checkedHire(installation, input, checks);
      if ((await rosterOf(ctx).getOptional(input.id)) !== undefined) {
        throw new Error(`"${input.id}" is already on the user's roster. Pick another id. Nothing was written.`);
      }
    }
  });

  const confirmFire = handler({
    name: "workforce-fire-confirm",
    inputSchema: blocks.fire.inputSchema,
    outputSchema: z.void(),
    resources: { ...installation.resources },
    execute: async (input: { id: string }, ctx: BlockContext) => {
      refuseUnasked(ctx, "fired");
      if (ctx.suspend === undefined) {
        throw new Error("This server can't ask the user to approve, and a worker is fired only on their yes. Nothing was written.");
      }
      if (installation.standardWorker(input.id) !== undefined) {
        throw new Error(`"${input.id}" is a standard worker, which nobody can fire: its files are changed by editing its folder. Nothing was written.`);
      }
      if ((await rosterOf(ctx).getOptional(input.id)) === undefined) throw new Error(`No worker "${input.id}" on the user's roster. Nothing was written.`);
      await ctx.suspend!({ reason: "user_approval", message: `Fire worker "${input.id}"?`, data: { worker: input.id }, allow: ["approve", "reject"] });
    }
  });

  const hire = sequencer({
    name: "hire",
    description:
      "Hire a worker of the user's own: `id` is a short lowercase slug, `flow` the flow it runs on " +
      "(`agent` when omitted), `description` one line on what it does, `instructions` its guidance, and `settings` the keys its " +
      "file would declare (such as `model` and `tools`). Only when the user asks for one. Everything is checked first, and a " +
      "refusal says why. Never pass an API key.",
    inputSchema: blocks.hire.inputSchema,
    outputSchema: blocks.hire.outputSchema
  })
    .tap(checkHire)
    .step(blocks.hire);

  const fire = sequencer({
    name: "fire",
    description: "Fire one of the user's own workers, by its id, once the user approves it. A worker the files declare can't be fired.",
    inputSchema: blocks.fire.inputSchema,
    outputSchema: blocks.fire.outputSchema
  })
    .tap(confirmFire)
    .step(blocks.fire);

  return defineCapability({
    name: HIRE_WORKERS_CAPABILITY,
    resources: { ...installation.resources },
    presets: { tools: { tools: [hire, fire] }, default: ["tools"] }
  });
}
