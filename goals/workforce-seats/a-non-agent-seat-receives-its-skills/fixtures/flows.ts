/**
 * A hireable worker kind with no model in it.
 *
 * This is the whole point of the goal beside it: the admission contract is not
 * an agent feature. A kind that never calls a generator composes the same
 * contract, is handed the same bag, and receives the skills its seat's folders
 * resolved — and a block nested inside its action can read them.
 *
 * Three kinds, and they do not all make the same claim. `triageFlow` composes
 * the contract and carries the DELIVERY claim: a nested block reads the skills
 * its seat's folders resolved. `noContractFlow` and `handRolledFlow` are a
 * control pair carrying the STRUCTURAL claim: hire imposes a bag, and a schema
 * that cannot accept it is refused. They run a different action set on purpose
 * — see `controlActions` below.
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

/**
 * What the CONTROL pair's nested block needs: the kind's own setting, and
 * nothing the admission contract imposes.
 *
 * Mirrors the sibling goal's `needsDesk`. The reason it exists is the reason
 * the control pair does not share `triageFlow`'s action set: `recordSkills`
 * independently requires `seatSkills` through its `flowConfigSchema`, so a
 * control that ran it would be refused by that block's requirement whether or
 * not its own schema could accept the imposed bag. Both causes would produce
 * the same refusal, and the control would certify whichever one the reader
 * already believed — the exact conflation this pair was rebuilt to remove.
 */
const needsDesk = z.object({ desk: z.string() });

/**
 * The control pair's nested read: its own setting only.
 *
 * Still NESTED rather than at the action root, for the reason `recordSkills`
 * is: the pair's positive half must run to completion on a real spread, not
 * merely mint.
 */
const recordDesk = handler({
  name: "triage-record-desk",
  inputSchema,
  outputSchema: z.void(),
  flowConfigSchema: needsDesk,
  sessionStateSchema: seatState,
  execute: async (_input, ctx) => {
    await ctx.session.patchState({ desk: ctx.flow.config.desk });
  }
});

/** The delivery claim's action set — reads the admitted `seatSkills`. */
const actions = {
  run: {
    inputSchema,
    block: sequencer({ name: "triage-work", inputSchema }).tap(start).tap(recordSkills)
  }
};

/**
 * The structural claim's action set — requires only `desk`.
 *
 * Separate from `actions` so that the control pair's outcome is decided by
 * each kind's own `configSchema` and by nothing else in the fixture.
 */
const controlActions = {
  run: {
    inputSchema,
    block: sequencer({ name: "triage-control-work", inputSchema }).tap(start).tap(recordDesk)
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
 *
 * For the same reason it runs `controlActions` rather than `triageFlow`'s: an
 * action set containing `recordSkills` would REQUIRE `seatSkills` through that
 * block's own `flowConfigSchema`, and this kind would then be refused by the
 * block whether or not its schema could accept the imposed bag — a second
 * cause, reintroducing the conflation the paragraph above removes.
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
  actions: controlActions,
  session: { stateSchema: seatState, client: clientView }
});

/**
 * The positive half of the same rule: a hand-written schema that accepts
 * everything hire imposes, without ever calling `workerConfigSchema()`.
 *
 * It hires. Without it, the refusal above would still be consistent with a
 * nominal check, and this goal would certify a rule the implementation rejects.
 *
 * Runs `controlActions` like its twin, so the pair differs in exactly one
 * thing: whether its `configSchema` declares `seatSkills`.
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
  actions: controlActions,
  session: { stateSchema: seatState, client: clientView }
});
