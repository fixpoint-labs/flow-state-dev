/**
 * A worker flow with no model in it, run by one registered copy for every
 * worker on it.
 *
 * This is the whole point of the goal beside it: the admission contract is not
 * an agent feature. A flow that never calls a generator composes the same
 * contract, and each turn's worker, loaded through the installation, carries
 * the skills its folders resolved — and a block nested inside its action can
 * read them.
 *
 * Three flows, and they do not all make the same claim. `defineTriageFlow`
 * composes the contract and carries the DELIVERY claim: a nested block reads
 * the skills the turn's worker's folders resolved. `noContractFlow` and
 * `handRolledFlow` are a control pair carrying the STRUCTURAL claim: a worker
 * is checked against its flow's `configSchema`, and a schema that cannot take
 * the bag a worker is handed is refused. They run a different action set on
 * purpose — see `controlActions` below.
 *
 * Each member of the pair is built on its own installation, the workforce
 * kit's over its own folder, because a flow declares one installation's
 * session: `controlTree` holds the good workers and the legacy one on the
 * no-contract flow, `twinTree` the good workers and one on the hand-rolled
 * flow. The pair stays two top-level builders returning `defineFlow` calls,
 * which `goals/scripts/validate-control-shape.mts` reads.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import {
  workerConfigOf,
  workerFlow,
  workerConfigSchema,
  workerMessagesResources,
  type WorkerInstallation,
  type WorkerManifest
} from "@flow-state-dev/workforce";
import { z } from "zod";
import { hearsMessages, workerDoor } from "../../../lib/worker-door.mts";
import { workforceTree } from "../../../lib/workers.mts";

export const TRIAGE_KIND = "request-triage";
export const NO_CONTRACT_KIND = "request-triage-legacy";
export const HAND_ROLLED_KIND = "request-triage-handrolled";

const here = dirname(fileURLToPath(import.meta.url));

/** The good tree: two seats on the triage flow, each with its own skills. */
export const goodTree = join(here, "workforce");

/** The one worker on the hand-rolled flow, hand-built: the twin's positive half. */
export const HAND_ROLLED_WORKER: WorkerManifest = {
  id: "support.handrolled",
  declared: { description: "Hand-rolled, never composed.", flow: HAND_ROLLED_KIND, desk: "loft" },
  body: "You hold the hand-rolled desk."
};

const inputSchema = z.object({ note: z.string() });

/** What the worker records about itself while running. */
const seatState = z.object({
  /** The worker's skill names, in the order they reached the block. */
  skills: z.array(z.string()).nullable().default(null),
  desk: z.string().nullable().default(null),
  /** Whether the turn's worker carried the contract's `workerSkills` key at all. */
  hasSeatSkills: z.boolean().nullable().default(null),
  runs: z.number().default(0)
});

const clientView = { expose: ["skills", "desk", "hasSeatSkills", "runs"] as const };

/** The flow's `request.onStarted`: loads the turn's worker, on every run of a request. */
function loadWorker(installation: WorkerInstallation, kind: string) {
  return handler({
    name: `${kind}-load-worker`,
    inputSchema: z.unknown(),
    resources: { ...installation.resources },
    execute: async (_input: unknown, ctx: BlockContext) => ({ worker: (await installation.resolveWorker(ctx, kind)).id })
  });
}

/**
 * Counts the turn, and reads no setting at all — so a pass here cannot mask a
 * nested failure.
 */
const start = handler({
  name: "triage-start",
  inputSchema,
  execute: async (_input, ctx) => {
    await ctx.session.incState({ runs: 1 });
  }
});

/**
 * The nested read — the far end of the journey a skill folder takes: the
 * turn's worker, as the installation loaded it.
 *
 * Order is preserved rather than sorted: the contract promises level order
 * (org, then team, then the worker's own), and sorting here would throw away
 * the only evidence of it.
 */
const recordSkills = handler({
  name: "triage-record",
  inputSchema,
  outputSchema: z.void(),
  sessionStateSchema: seatState,
  execute: async (_input, ctx) => {
    const config = workerConfigOf(ctx) as { workerSkills?: Array<{ name: string }>; desk?: string };
    await ctx.session.patchState({
      skills: (config.workerSkills ?? []).map((skill) => skill.name),
      desk: config.desk ?? null,
      hasSeatSkills: Object.hasOwn(config, "workerSkills")
    });
  }
});

/**
 * The control pair's nested read: its own setting, and whether the contract's
 * key arrived, but no requirement on any setting. A block that required
 * `workerSkills` would refuse the control on its own, whether or not its schema
 * could take the bag, and certify whichever cause the reader already believed.
 */
const recordDesk = handler({
  name: "triage-record-desk",
  inputSchema,
  outputSchema: z.void(),
  sessionStateSchema: seatState,
  execute: async (_input, ctx) => {
    const config = workerConfigOf(ctx) as { desk?: string };
    await ctx.session.patchState({ desk: config.desk ?? null, hasSeatSkills: Object.hasOwn(config, "workerSkills") });
  }
});

/** The delivery claim's action set — reads the turn's `workerSkills`. */
const actions = {
  run: {
    inputSchema,
    block: sequencer({ name: "triage-work", inputSchema }).tap(start).tap(recordSkills)
  },
  ...workerDoor
};

/**
 * The structural claim's action set — requires no setting.
 *
 * Separate from `actions` so that the control pair's outcome is decided by
 * each flow's own `configSchema` and by nothing else in the fixture.
 */
const controlActions = {
  run: {
    inputSchema,
    block: sequencer({ name: "triage-control-work", inputSchema }).tap(start).tap(recordDesk)
  },
  ...workerDoor
};

/** Composes the contract. No model, no generator — handlers only. */
export function defineTriageFlow(installation: WorkerInstallation) {
  return defineFlow({
    kind: TRIAGE_KIND,
    cardinality: "collection",
    configSchema: workerConfigSchema().extend({ desk: z.string().default("front") }),
    resources: { ...installation.resources, ...workerMessagesResources },
    request: { onStarted: loadWorker(installation, TRIAGE_KIND) },
    actions,
    internal: { actions: hearsMessages(installation, TRIAGE_KIND) },
    session: { ...installation.session(seatState.shape), client: clientView }
  });
}

/** The good workers, and the legacy one on the no-contract flow. */
export const controlTree = workforceTree([], {}, [goodTree, join(here, "no-contract")]);

/** The good workers, and the one on the hand-rolled flow. */
export const twinTree = workforceTree([HAND_ROLLED_WORKER], {}, [goodTree]);

/**
 * The control: a schema that **cannot take the bag a worker is handed**,
 * because it omits `workerSkills`.
 *
 * Deliberately not "the same flow with `workerConfigSchema()` removed". That
 * version refuses too, but removing the helper also removes every contract key,
 * so the refusal is equally consistent with a check on whether the helper was
 * CALLED — which there is not and cannot be. This one declares the other
 * contract keys and omits the one that makes the bag unacceptable, so only the
 * structural cause is left.
 */
export const noContractFlow = (installation: WorkerInstallation) =>
  defineFlow({
  kind: NO_CONTRACT_KIND,
  cardinality: "collection",
  configSchema: z.object({
    instructions: z.string().optional(),
    teamInstructions: z.string().optional(),
    // Declared so `workerSkills` stays the SINGLE missing key.
    workerTools: z.array(z.any()).default([]),
    workerPackages: z.array(z.any()).optional(),
    // Imposed on every worker: its own id.
    workerId: z.string().optional(),
    delegates: z.array(z.string()).default([]),
    defaults: z.any().optional(),
    // `workerSkills` omitted — the single reason the bag is refused.
    desk: z.string().default("front")
  }),
  resources: { ...installation.resources, ...workerMessagesResources },
  request: { onStarted: loadWorker(installation, NO_CONTRACT_KIND) },
  actions: controlActions,
  internal: { actions: hearsMessages(installation, NO_CONTRACT_KIND) },
  session: { ...installation.session(seatState.shape), client: clientView }
});

/**
 * The positive half of the same rule: a hand-written schema that takes
 * everything a worker is handed, without ever calling `workerConfigSchema()`.
 * It registers, and its worker runs.
 *
 * Runs `controlActions` like its twin, so the pair differs in exactly one
 * thing: whether its `configSchema` declares `workerSkills`.
 */
export const handRolledFlow = (installation: WorkerInstallation) =>
  defineFlow({
  kind: HAND_ROLLED_KIND,
  cardinality: "collection",
  configSchema: z.object({
    instructions: z.string().optional(),
    teamInstructions: z.string().optional(),
    workerSkills: z.array(z.object({ name: z.string(), skillMd: z.string() }).passthrough()).default([]),
    workerTools: z.array(z.any()).default([]),
    workerPackages: z.array(z.any()).optional(),
    workerId: z.string().optional(),
    delegates: z.array(z.string()).default([]),
    defaults: z.any().optional(),
    desk: z.string().default("front")
  }),
  resources: { ...installation.resources, ...workerMessagesResources },
  request: { onStarted: loadWorker(installation, HAND_ROLLED_KIND) },
  actions: controlActions,
  internal: { actions: hearsMessages(installation, HAND_ROLLED_KIND) },
  session: { ...installation.session(seatState.shape), client: clientView }
});

/** The control tree's worker flows. */
export const controlFlows = { [TRIAGE_KIND]: workerFlow(defineTriageFlow), [NO_CONTRACT_KIND]: workerFlow(noContractFlow) };

/** The twin tree's worker flows. */
export const twinFlows = { [TRIAGE_KIND]: workerFlow(defineTriageFlow), [HAND_ROLLED_KIND]: workerFlow(handRolledFlow) };
