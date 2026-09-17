/**
 * The two worker flow kinds an app defines in code — what a worker's folder
 * points at, never what the folder builds.
 *
 * Both compose the admission contract, as every hireable kind must. One is
 * opinionated — it REQUIRES `instructions`, so a seat of that kind without a
 * body is a failed hire. One is thin: it requires only a setting of its own and
 * leaves the contract's instructions door empty.
 *
 * Both read their settings from a block NESTED inside the action sequencer
 * rather than at the root, because a read that works at the root proves nothing
 * about the context spread that carries the value down. Neither calls a model:
 * the property under test is which settings reach a running block.
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { workerConfigSchema } from "@flow-state-dev/workforce";
import { z } from "zod";

export const CUSTOM_AGENT_KIND = "custom-agent";
export const INTAKE_KIND = "intake";
export const NO_CONTRACT_KIND = "legacy-desk";

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
  name: "custom-agent-record",
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

export const customAgentFlow = defineFlow({
  kind: CUSTOM_AGENT_KIND,
  cardinality: "collection",
  configSchema: workerConfigSchema().extend({
    /**
     * REQUIRED here, which is this kind's own call: the contract's own
     * `instructions` is optional, and a kind is free to tighten it. That is
     * what makes this kind opinionated — a seat of this kind without
     * instructions is a failed hire.
     */
    instructions: z.string(),
    model: z.string().default("openai/gpt-5.4-mini"),
    tools: z.array(z.string()).default([])
  }),
  actions: {
    run: { inputSchema, block: sequencer({ name: "custom-agent-work", inputSchema }).step(start).tap(recordInstructions) }
  },
  session: { stateSchema: seatState, client: clientView }
});

export const intakeFlow = defineFlow({
  kind: INTAKE_KIND,
  cardinality: "collection",
  // Thin in what it REQUIRES, not in what it admits. It composes the contract
  // like every hireable kind, so `instructions` is a door it has and leaves
  // empty; the seat under it carries none because its record has no body.
  configSchema: workerConfigSchema().extend({ desk: z.string().default("front") }),
  actions: {
    run: { inputSchema, block: sequencer({ name: "intake-work", inputSchema }).step(start).tap(recordDesk) }
  },
  session: { stateSchema: seatState, client: clientView }
});

/**
 * A kind written before the admission contract existed and never updated —
 * settings of its own, and nowhere for a seat's skills or instructions to
 * arrive.
 *
 * It is here to be REFUSED. Hire hands every kind the same bag, so this one
 * cannot take it, and the whole roster stops at boot naming the door it has to
 * open. That refusal is the one this goal grades; nothing here ever runs.
 */
export const noContractFlow = defineFlow({
  kind: NO_CONTRACT_KIND,
  cardinality: "collection",
  configSchema: z.object({ desk: z.string().default("front") }),
  actions: {
    run: { inputSchema, block: sequencer({ name: "legacy-work", inputSchema }).step(start).tap(recordDesk) }
  },
  session: { stateSchema: seatState, client: clientView }
});
