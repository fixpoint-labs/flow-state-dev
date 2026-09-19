/**
 * A hireable worker kind with no model in it, whose NESTED block reports both
 * instruction layers it was handed.
 *
 * No model and no generator on purpose: the claim this goal makes is about
 * *which settings reach a running block*, and an end-to-end run of the built-in
 * `agent` kind would be green for a mechanism that only ever worked on the one
 * kind that happens to compose the prompt. The property under test has nothing
 * to do with agents.
 *
 * It reads BOTH keys and records them separately, because "the team's text
 * arrived" and "the seat's own survived" are two claims and a single merged
 * string would satisfy neither on its own.
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { workerConfigSchema } from "@flow-state-dev/workforce";
import { z } from "zod";

export const TRIAGE_KIND = "request-triage";

const inputSchema = z.object({ note: z.string() });

/** What the seat records about itself while running. */
const seatState = z.object({
  /**
   * The seat's team-level instructions, as the running block saw them.
   *
   * Two nullable fields rather than one object, and `null` as the default,
   * because the thing under test is partly the difference between a value that
   * arrived and one that did not. A default of `""` would make an absent layer
   * and an empty one read back identically — which is the exact confusion this
   * feature is built to avoid.
   */
  team: z.string().nullable().default(null),
  /** Whether the key was present at all, which `team: null` alone cannot say. */
  teamKeyPresent: z.boolean().nullable().default(null),
  /** The seat's own instructions, as the running block saw them. */
  own: z.string().nullable().default(null),
  desk: z.string().nullable().default(null),
  runs: z.number().default(0)
});

/**
 * What the nested block needs of whatever flow installs it.
 *
 * It names the contract's own keys, which is what makes this a read of the
 * admitted bag rather than of anything this fixture arranged. Both are optional
 * because both genuinely are: a seat whose team wrote nothing has no team
 * layer, and that is not a failure.
 */
const needsInstructionLayers = z.object({
  instructions: z.string().optional(),
  teamInstructions: z.string().optional(),
  desk: z.string()
});

/**
 * Counts the turn, and reads no config at all — so a pass here cannot mask a
 * nested failure.
 *
 * State-only, so it declares no `outputSchema`, returns nothing, and is chained
 * with `.tap()` (BP-012 / BP-014).
 */
const start = handler({
  name: "triage-start",
  inputSchema,
  execute: async (_input, ctx) => {
    await ctx.session.incState({ runs: 1 });
  }
});

/**
 * The nested read — the far end of the journey a `TEAM.md` body takes.
 *
 * `Object.hasOwn` is recorded beside the value deliberately. Reading the value
 * alone cannot tell an absent key from one holding an empty string, and
 * "absent, never empty" is half of what this feature promises.
 */
const recordLayers = handler({
  name: "triage-record",
  inputSchema,
  outputSchema: z.void(),
  flowConfigSchema: needsInstructionLayers,
  sessionStateSchema: seatState,
  execute: async (_input, ctx) => {
    await ctx.session.patchState({
      team: ctx.flow.config.teamInstructions ?? null,
      teamKeyPresent: Object.hasOwn(ctx.flow.config, "teamInstructions"),
      own: ctx.flow.config.instructions ?? null,
      desk: ctx.flow.config.desk
    });
  }
});

const clientView = {
  derived: {
    ran: (ctx: {
      state: {
        team?: string | null;
        teamKeyPresent?: boolean | null;
        own?: string | null;
        desk?: string | null;
        runs?: number;
      };
    }) => ({
      team: ctx.state.team ?? null,
      teamKeyPresent: ctx.state.teamKeyPresent ?? null,
      own: ctx.state.own ?? null,
      desk: ctx.state.desk ?? null,
      runs: ctx.state.runs ?? 0
    })
  }
};

/** Composes the contract. No model, no generator — handlers only. */
export const triageFlow = defineFlow({
  kind: TRIAGE_KIND,
  cardinality: "collection",
  configSchema: workerConfigSchema().extend({ desk: z.string().default("front") }),
  actions: {
    run: {
      inputSchema,
      block: sequencer({ name: "triage-work", inputSchema }).tap(start).tap(recordLayers)
    }
  },
  session: { stateSchema: seatState, client: clientView }
});
