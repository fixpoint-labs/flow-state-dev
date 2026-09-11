/**
 * The two worker flow kinds an app defines in code — what a worker's folder
 * points at, never what the folder builds.
 *
 * One is opinionated: it declares that it takes `instructions`, which is where a
 * worker's body arrives. One is thin: it declares a setting of its own and no
 * instructions at all, so a body handed to it is refused by its own schema.
 *
 * Both read their settings from a block NESTED inside the action sequencer
 * rather than at the root, because a read that works at the root proves nothing
 * about the context spread that carries the value down. Neither calls a model:
 * the property under test is which settings reach a running block.
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

export const WORKER_AGENT_KIND = "worker-agent";
export const INTAKE_KIND = "intake";

const inputSchema = z.object({ note: z.string() });

/** What a seat records about itself while running. Shared by both kinds. */
const seatState = z.object({
  /** The body, as it reached a block — null when the seat carries none. */
  instructions: z.string().nullable().default(null),
  model: z.string().nullable().default(null),
  desk: z.string().nullable().default(null),
  runs: z.number().default(0)
});

/** What the opinionated kind's nested block needs of whatever flow installs it. */
const needsInstructions = z.object({ instructions: z.string(), model: z.string() });
/** What the thin kind's nested block needs. Note: no instructions. */
const needsDesk = z.object({ desk: z.string() });

/** The root: reads no config at all, so it cannot mask a nested failure. */
const start = handler({
  name: "seat-start",
  inputSchema,
  outputSchema: inputSchema,
  execute: async (input, ctx) => {
    await ctx.session.incState({ runs: 1 });
    return input;
  }
});

/** Nested read, opinionated kind — the far end of the body's journey. */
const recordInstructions = handler({
  name: "worker-agent-record",
  inputSchema,
  outputSchema: z.void(),
  flowConfigSchema: needsInstructions,
  sessionStateSchema: seatState,
  execute: async (_input, ctx) => {
    await ctx.session.patchState({
      instructions: ctx.flow.config.instructions,
      model: ctx.flow.config.model
    });
  }
});

/** Nested read, thin kind — writes its own setting and no instructions. */
const recordDesk = handler({
  name: "intake-record",
  inputSchema,
  outputSchema: z.void(),
  flowConfigSchema: needsDesk,
  sessionStateSchema: seatState,
  execute: async (_input, ctx) => {
    await ctx.session.patchState({ desk: ctx.flow.config.desk });
  }
});

const clientView = {
  derived: {
    ran: (ctx: {
      state: { instructions?: string | null; model?: string | null; desk?: string | null; runs?: number };
    }) => ({
      instructions: ctx.state.instructions ?? null,
      model: ctx.state.model ?? null,
      desk: ctx.state.desk ?? null,
      runs: ctx.state.runs ?? 0
    })
  }
};

export const workerAgentFlow = defineFlow({
  kind: WORKER_AGENT_KIND,
  cardinality: "collection",
  configSchema: z.object({
    /** Where a worker's instructions arrive. Declaring it is what makes this kind opinionated. */
    instructions: z.string(),
    model: z.string().default("openai/gpt-5.4-mini"),
    tools: z.array(z.string()).default([])
  }),
  actions: {
    run: { inputSchema, block: sequencer({ name: "worker-agent-work", inputSchema }).step(start).tap(recordInstructions) }
  },
  session: { stateSchema: seatState, client: clientView }
});

export const intakeFlow = defineFlow({
  kind: INTAKE_KIND,
  cardinality: "collection",
  // No `instructions` here, deliberately: a body handed to this kind refuses at the
  // hire, by name, without this flow checking for one.
  configSchema: z.object({ desk: z.string().default("front") }),
  actions: {
    run: { inputSchema, block: sequencer({ name: "intake-work", inputSchema }).step(start).tap(recordDesk) }
  },
  session: { stateSchema: seatState, client: clientView }
});
