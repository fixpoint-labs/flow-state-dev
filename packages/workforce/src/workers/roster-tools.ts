/**
 * Hiring and firing from a conversation: `hire` and `fire`, the roster
 * flow's own `hire` and `fire` blocks (`hire-blocks.ts`) as a worker's tools,
 * each waiting for the user's approval before it writes.
 *
 * They write the roster of the user talking to the worker, through the same
 * blocks the user's own Hire form and Fire button run, so a hire is checked
 * exactly as the form's is (the flow's schema, a key-shaped value, the app's
 * listed models) and shows on the roster at once. What the tools add in front
 * of the write:
 *
 * - **Only on the user's own turn.** A turn a delivered event, a worker's
 *   message, a routine or a task started can't hire or fire: text read there
 *   could ask for one. The same mark gates the standing-rule tools.
 * - **Checks before asking.** Every check the write makes, and an id already
 *   on the roster (or one not there, for a fire), refuses before the user is
 *   asked, with the reason.
 * - **The user's approval.** A stock `user_approval` shows what will be
 *   written: for a hire, the id, the flow, the description, the settings and
 *   the instructions it will keep. Reject throws out of the tool before the
 *   write. Without durable execution there is nobody to ask, so it refuses.
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
export const HIRE_WORKERS_CAPABILITY = "hireWorkers";

/** The roster of the user this turn runs for. */
function rosterOf(ctx: BlockContext): ResourceCollectionRef {
  return (ctx.resources as Record<string, unknown>)[WORKERS_RESOURCE] as ResourceCollectionRef;
}

/** Refuse unless the user's own message started this turn and the server can ask them. */
function refuseUnasked(ctx: BlockContext, verb: string): void {
  if (!isUserTurn(ctx)) {
    throw new Error(`A worker is ${verb} only on a turn the user's own message started; this one can't. Nothing was written.`);
  }
  if (ctx.suspend === undefined) {
    throw new Error(`This server can't ask the user to approve, and a worker is ${verb} only on their yes. Nothing was written.`);
  }
}

/** The settings a hire keeps, one per line, for the approval. */
function settingsLines(settings: Record<string, unknown> | undefined): string {
  const entries = Object.entries(settings ?? {});
  return entries.length === 0 ? "none" : entries.map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join("; ");
}

/**
 * `hire` and `fire` over `installation`, as the capability `hireWorkers`.
 * `checks` is what the roster's own hire is checked against: pass the app's
 * `hire` config, the same the kit gives the roster flow.
 */
export function hireWorkersCapability(installation: WorkerInstallation, checks: HireChecks = {}) {
  const blocks = createWorkerHireBlocks(installation, checks);

  // Every check the write makes, then the user's yes. Reject throws out of the tool before the write.
  const askHire = handler({
    name: "workforce-hire-ask",
    inputSchema: blocks.hire.inputSchema,
    outputSchema: z.void(),
    resources: { ...installation.resources },
    execute: async (input: HireInput, ctx: BlockContext) => {
      refuseUnasked(ctx, "hired");
      const worker = checkedHire(installation, input, checks);
      if ((await rosterOf(ctx).getOptional(input.id)) !== undefined) {
        throw new Error(`"${input.id}" is already on the user's roster. Pick another id. Nothing was written.`);
      }
      await ctx.suspend!({
        reason: "user_approval",
        message:
          `Hire ${worker.name ?? input.id} (${input.id}) on ${worker.flow}: ${worker.description ?? "no description"}. ` +
          `Settings: ${settingsLines(worker.settings)}.` +
          (worker.instructions === null ? "" : `\n\nIts instructions:\n${worker.instructions}`),
        data: { id: input.id, flow: worker.flow, description: worker.description, settings: worker.settings, instructions: worker.instructions },
        allow: ["approve", "reject"]
      });
    }
  });

  const askFire = handler({
    name: "workforce-fire-ask",
    inputSchema: blocks.fire.inputSchema,
    outputSchema: z.void(),
    resources: { ...installation.resources },
    execute: async (input: { id: string }, ctx: BlockContext) => {
      refuseUnasked(ctx, "fired");
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
      "Hire a worker of the user's own, once the user approves it: `id` is a short lowercase slug, `flow` the flow it runs on " +
      "(`agent` when omitted), `description` one line on what it does, `instructions` its guidance, and `settings` the keys its " +
      "file would declare (such as `model` and `tools`). Only when the user asks for one. Everything is checked first, and a " +
      "refusal says why. Never pass an API key.",
    inputSchema: blocks.hire.inputSchema,
    outputSchema: blocks.hire.outputSchema
  })
    .tap(askHire)
    .step(blocks.hire);

  const fire = sequencer({
    name: "fire",
    description: "Fire one of the user's own workers, by its id, once the user approves it. A worker the files declare can't be fired.",
    inputSchema: blocks.fire.inputSchema,
    outputSchema: blocks.fire.outputSchema
  })
    .tap(askFire)
    .step(blocks.fire);

  return defineCapability({
    name: HIRE_WORKERS_CAPABILITY,
    resources: { ...installation.resources },
    presets: { tools: { tools: [hire, fire] }, default: ["tools"] }
  });
}
