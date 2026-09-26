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
export const HAND_ROLLED_KIND = "hand-rolled-desk";

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
 * A kind whose schema **cannot accept the bag hire imposes** — it declares
 * `instructions` but not `seatSkills`.
 *
 * Deliberately not "a kind with no contract keys at all". That version refused
 * too, but for a reason that only *coincided* with the rule: stripping the
 * helper also stripped the keys, so the observed refusal was equally consistent
 * with hire checking whether `workerConfigSchema()` was called. It is not — see
 * `handRolledFlow` below. This kind isolates the real cause by declaring part
 * of the contract and still missing a key the bag carries.
 */
export const noContractFlow = defineFlow({
  kind: NO_CONTRACT_KIND,
  cardinality: "collection",
  configSchema: z.object({
    instructions: z.string().optional(),
    teamInstructions: z.string().optional(),
    // Declared so `seatSkills` stays the SINGLE missing key: the contract grew a
    // fourth, and a control that omitted two would no longer isolate one cause.
    seatTools: z.array(z.any()).default([]),
    // The sixth, imposed on every seat: its own id.
    seatId: z.string().optional(),
    // `seatSkills` is absent — the one key that makes the bag unacceptable.
    desk: z.string().default("front")
  }),
  actions: {
    run: { inputSchema, block: sequencer({ name: "legacy-work", inputSchema }).step(start).tap(recordDesk) }
  },
  session: { stateSchema: seatState, client: clientView }
});

/**
 * The other half of the same rule, and the reason the refusal above means what
 * it says: a schema that accepts the imposed bag **without ever calling
 * `workerConfigSchema()`** hires exactly like a composed kind.
 *
 * Without this, the goal would certify a nominal invariant the implementation
 * rejects — "a kind that did not call the helper refuses" — which is true of
 * its fixture and false of the system.
 */
export const handRolledFlow = defineFlow({
  kind: HAND_ROLLED_KIND,
  cardinality: "collection",
  configSchema: z.object({
    instructions: z.string().optional(),
    teamInstructions: z.string().optional(),
    seatSkills: z.array(z.object({ name: z.string(), skillMd: z.string() }).passthrough()).default([]),
    // The fourth contract key. A hand-rolled schema has to add each one as the
    // contract grows — which is the cost this fixture exists to show, not a
    // reason to stop hand-rolling.
    seatTools: z.array(z.any()).default([]),
    // The sixth, imposed on every seat: its own id.
    seatId: z.string().optional(),
    desk: z.string().default("front")
  }),
  actions: {
    run: { inputSchema, block: sequencer({ name: "hand-rolled-work", inputSchema }).step(start).tap(recordDesk) }
  },
  session: { stateSchema: seatState, client: clientView }
});
