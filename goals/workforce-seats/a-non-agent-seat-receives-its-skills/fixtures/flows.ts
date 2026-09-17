/**
 * A hireable worker kind with no model in it.
 *
 * This is the whole point of the goal beside it: the admission contract is not
 * an agent feature. A kind that never calls a generator composes the same
 * contract, is handed the same bag, and receives the skills its seat's folders
 * resolved — and a block nested inside its action can read them.
 *
 * Two kinds, identical but for one line. `triageFlow` composes the contract.
 * `noContractFlow` does not, and exists to be refused.
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { workerConfigSchema } from "@flow-state-dev/workforce";
import { z } from "zod";

export const TRIAGE_KIND = "request-triage";
export const NO_CONTRACT_KIND = "request-triage-legacy";
export const HAND_ROLLED_KIND = "request-triage-handrolled";

const inputSchema = z.object({ note: z.string() });

/** What the seat records about itself while running. */
const seatState = z.object({
  /** The seat's skill names, in the order they reached the block. */
  skills: z.array(z.string()).nullable().default(null),
  desk: z.string().nullable().default(null),
  runs: z.number().default(0)
});

/**
 * What the nested block needs of whatever flow installs it.
 *
 * It names `seatSkills` — the contract's key — which is what makes this a read
 * of the admitted bag rather than of anything this fixture arranged.
 */
const needsSeatSkills = z.object({
  seatSkills: z.array(z.object({ name: z.string() })),
  desk: z.string()
});

/**
 * Counts the turn, and reads no config at all — so a pass here cannot mask a
 * nested failure.
 *
 * State-only, so it declares no `outputSchema`, returns nothing, and is chained
 * with `.tap()` (BP-012 / BP-014). The mutation is already observable in the
 * state-change log; echoing the input back would only pad the items log.
 */
const start = handler({
  name: "triage-start",
  inputSchema,
  execute: async (_input, ctx) => {
    await ctx.session.incState({ runs: 1 });
  }
});

/**
 * The nested read — the far end of the journey a skill folder takes.
 *
 * Order is preserved rather than sorted: the contract promises level order
 * (org, then team, then the seat's own), and sorting here would throw away the
 * only evidence of it.
 */
const recordSkills = handler({
  name: "triage-record",
  inputSchema,
  outputSchema: z.void(),
  flowConfigSchema: needsSeatSkills,
  sessionStateSchema: seatState,
  execute: async (_input, ctx) => {
    await ctx.session.patchState({
      skills: ctx.flow.config.seatSkills.map((skill) => skill.name),
      desk: ctx.flow.config.desk
    });
  }
});

const clientView = {
  derived: {
    ran: (ctx: { state: { skills?: string[] | null; desk?: string | null; runs?: number } }) => ({
      skills: ctx.state.skills ?? null,
      desk: ctx.state.desk ?? null,
      runs: ctx.state.runs ?? 0
    })
  }
};

const actions = {
  run: {
    inputSchema,
    block: sequencer({ name: "triage-work", inputSchema }).tap(start).tap(recordSkills)
  }
};

/** Composes the contract. No model, no generator — handlers only. */
export const triageFlow = defineFlow({
  kind: TRIAGE_KIND,
  cardinality: "collection",
  configSchema: workerConfigSchema().extend({ desk: z.string().default("front") }),
  actions,
  session: { stateSchema: seatState, client: clientView }
});

/**
 * The control: a schema that **cannot accept the bag hire imposes**, because it
 * omits `seatSkills`.
 *
 * Deliberately not "the same kind with `workerConfigSchema()` removed". That
 * version refuses too, but removing the helper also removes every contract key,
 * so the refusal is equally consistent with hire checking whether the helper
 * was CALLED — which it does not and cannot. A control that conflates two
 * causes certifies whichever one the reader already believes. This one declares
 * two of the three contract keys and omits the one that makes the bag
 * unacceptable, so only the structural cause is left.
 */
export const noContractFlow = defineFlow({
  kind: NO_CONTRACT_KIND,
  cardinality: "collection",
  configSchema: z.object({
    instructions: z.string().optional(),
    teamInstructions: z.string().optional(),
    // `seatSkills` omitted — the single reason the imposed bag is refused.
    desk: z.string().default("front")
  }),
  actions,
  session: { stateSchema: seatState, client: clientView }
});

/**
 * The positive half of the same rule: a hand-written schema that accepts
 * everything hire imposes, without ever calling `workerConfigSchema()`.
 *
 * It hires. Without it, the refusal above would still be consistent with a
 * nominal check, and this goal would certify a rule the implementation rejects.
 */
export const handRolledFlow = defineFlow({
  kind: HAND_ROLLED_KIND,
  cardinality: "collection",
  configSchema: z.object({
    instructions: z.string().optional(),
    teamInstructions: z.string().optional(),
    seatSkills: z.array(z.object({ name: z.string(), skillMd: z.string() }).passthrough()).default([]),
    desk: z.string().default("front")
  }),
  actions,
  session: { stateSchema: seatState, client: clientView }
});
