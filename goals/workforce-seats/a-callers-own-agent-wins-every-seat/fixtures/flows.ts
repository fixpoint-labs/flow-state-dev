/**
 * The caller's own `agent`, built on the installation: one copy every worker
 * on `agent` runs on, which reads each turn's worker through the installation.
 *
 * `desk` is the tell: the built-in declares no such setting, so a worker whose
 * turn reads one ran on the caller's flow.
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { workerConfigSchema, type WorkerInstallation } from "@flow-state-dev/workforce";
import { z } from "zod";
import { workerDoor } from "../../../lib/worker-door.mts";

const inputSchema = z.object({ note: z.string() });

/** The caller's settings bag. */
const callerSettings = workerConfigSchema().extend({
  desk: z.string().default("front")
});

/** The caller's flow, built on `installation`. */
export function defineCallerAgent(installation: WorkerInstallation) {
  const seatState = z.object({
    instructions: z.string().nullable().default(null),
    desk: z.string().nullable().default(null),
    runs: z.number().default(0)
  });
  const start = handler({
    name: "caller-start",
    inputSchema,
    outputSchema: inputSchema,
    sessionStateSchema: seatState,
    execute: async (input, ctx) => {
      await ctx.session.patchState({ runs: (ctx.session.state.runs ?? 0) + 1 });
      return input;
    }
  });
  /** Writes what THIS turn's worker carries, so the far end can read it back. */
  const recordSettings = handler({
    name: "caller-record",
    inputSchema,
    outputSchema: z.void(),
    sessionStateSchema: seatState,
    resources: { ...installation.resources },
    execute: async (_input, ctx) => {
      const { config } = await installation.resolveWorker(ctx, "agent");
      await ctx.session.patchState({
        instructions: typeof config.instructions === "string" ? config.instructions : null,
        desk: typeof config.desk === "string" ? config.desk : null
      });
    }
  });
  const session = installation.session(seatState.shape);
  return defineFlow({
    kind: "agent",
    cardinality: "collection",
    configSchema: callerSettings,
    resources: { ...installation.resources },
    actions: {
      run: {
        inputSchema,
        block: sequencer({ name: "caller-agent-work", inputSchema }).step(start).tap(recordSettings)
      },
      ...workerDoor
    },
    session: {
      ...session,
      client: {
        derived: {
          ran: (ctx: { state: { instructions?: string | null; desk?: string | null; runs?: number } }) => ({
            instructions: ctx.state.instructions ?? null,
            desk: ctx.state.desk ?? null,
            runs: ctx.state.runs ?? 0
          })
        }
      }
    }
  });
}
