/**
 * The caller's own `agent` — the replacement path, in both the shape that
 * works and the shape that does not.
 *
 * Both declare `kind: "agent"`, so both pass the hire step's mismatched-kind
 * check and both MINT. Only `collection` survives registration, which is the
 * whole reason this goal reaches the registry instead of stopping at the hire.
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const inputSchema = z.object({ note: z.string() });

/**
 * The caller's settings bag. `desk` is the tell: the built-in has no such
 * setting, so a seat carrying one cannot be ours.
 */
const callerSettings = z.object({
  instructions: z.string().optional(),
  desk: z.string().default("front")
});

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

/** Writes what THIS seat's own bag carried, so the far end can read it back. */
const recordSettings = handler({
  name: "caller-record",
  inputSchema,
  outputSchema: z.void(),
  flowConfigSchema: callerSettings,
  sessionStateSchema: seatState,
  execute: async (_input, ctx) => {
    await ctx.session.patchState({
      instructions: ctx.flow.config.instructions ?? null,
      desk: ctx.flow.config.desk
    });
  }
});

const clientView = {
  derived: {
    ran: (ctx: { state: { instructions?: string | null; desk?: string | null; runs?: number } }) => ({
      instructions: ctx.state.instructions ?? null,
      desk: ctx.state.desk ?? null,
      runs: ctx.state.runs ?? 0
    })
  }
};

const actions = {
  run: {
    inputSchema,
    block: sequencer({ name: "caller-agent-work", inputSchema }).step(start).tap(recordSettings)
  }
};

/** The supported replacement: declared `collection`, as the contract requires. */
export const callerAgentFlow = defineFlow({
  kind: "agent",
  cardinality: "collection",
  configSchema: callerSettings,
  actions,
  session: { stateSchema: seatState, client: clientView }
});

/**
 * The control. Identical but for the missing `cardinality`, which makes it a
 * singleton. Its seats mint exactly like the one above and are refused one by
 * one at REGISTRATION — the failure a check that stopped at the hire would
 * never see.
 */
export const callerAgentSingleton = defineFlow({
  kind: "agent",
  configSchema: callerSettings,
  actions,
  session: { stateSchema: seatState, client: clientView }
});
