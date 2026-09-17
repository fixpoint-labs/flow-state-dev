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

/** The root. Reads no config at all, so it cannot mask a nested failure. */
const start = handler({
  name: "triage-start",
  inputSchema,
  outputSchema: inputSchema,
  execute: async (input, ctx) => {
    await ctx.session.incState({ runs: 1 });
    return input;
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
    block: sequencer({ name: "triage-work", inputSchema }).step(start).tap(recordSkills)
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
 * The control. Identical but for the missing contract, which is the one line
 * under test — so a refusal here cannot be blamed on anything else about the
 * kind.
 */
export const noContractFlow = defineFlow({
  kind: NO_CONTRACT_KIND,
  cardinality: "collection",
  configSchema: z.object({ desk: z.string().default("front") }),
  actions,
  session: { stateSchema: seatState, client: clientView }
});
