/**
 * Entities — conductor's durable records, as resource collections.
 *
 * **Everything here is a resource, and every entity field lives in resource
 * state.** Scope state is for in-process state management that persists only
 * for durability; it is not a data-management surface, and conductor stores no
 * entity data there.
 *
 * Each entity splits across the two halves a resource already gives us:
 *
 * - **`stateSchema` → `ResourceStateStore`.** The structured fields, persisted
 *   per-key. This is the *reducer's read set* and nothing else.
 * - **content → `ContentStore`.** The prose: a spec document, a retrospective.
 *   Free-form, and never read by `decide`.
 *
 * That split is the rule that keeps M0 honest. `decide` is a pure, exhaustively
 * testable function *because* it reduces over structured fields. The moment a
 * phase, a gate, a round count, or a review state drifts into prose, the
 * reducer needs a model to read it and the whole determinism claim collapses.
 *
 * > **Structured state is exactly what `decide` reads. Everything else is content.**
 *
 * These are declarations only — `defineResourceCollection` comes from `core`,
 * so this module stays free of `engine` and M0 remains pure. Registering the
 * collections against a scope registry is M1's job.
 */

import { defineResourceCollection } from "@flow-state-dev/core";
import { z } from "zod";

/** Issue type — a routing key selecting discipline and review lenses, not a state machine. */
export const issueTypeSchema = z.enum([
  "Feature",
  "Improvement",
  "Bug",
  "Spike",
  "Prototype",
  "Refactor",
]);

export type IssueType = z.infer<typeof issueTypeSchema>;

/** Where an artifact is hosted. A PR is not an entity — it is a hosting location. */
export const hostedAtSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pr"), number: z.number().int() }),
  z.object({ type: z.literal("file"), path: z.string() }),
]);

/** One unit of work moving through the issue phases. */
export const issueStateSchema = z.object({
  id: z.string(),
  kind: z.literal("issue"),
  phase: z.enum(["SPEC", "IMPLEMENTATION", "SETTLED"]),
  issueType: issueTypeSchema,
  /** Parent epic, when this issue runs under one. */
  epicId: z.string().nullable().default(null),
  /** Linear identifier, when a Linear connector is configured. Conductor runs without one. */
  externalKey: z.string().nullable().default(null),
  /** ISO timestamp of the newest signal reduced against this entity. */
  lastSignalAt: z.string().nullable().default(null),
});

/** A set of related issues under a shared objective. */
export const epicStateSchema = z.object({
  id: z.string(),
  kind: z.literal("epic"),
  phase: z.enum(["FRAMING", "CROSS_SPEC_REVIEW", "ISSUES", "WRAP", "SETTLED"]),
  externalKey: z.string().nullable().default(null),
  lastSignalAt: z.string().nullable().default(null),
});

/**
 * A reviewable output of a phase. The document body is the resource's
 * **content**; only the fields gates read live in state.
 */
export const artifactStateSchema = z.object({
  id: z.string(),
  entityId: z.string(),
  kind: z.enum(["spec", "implementation", "epic_spec", "retrospective"]),
  hostedAt: hostedAtSchema,
  /** Completed review rounds — the number the budget is spent against. */
  reviewRounds: z.number().int().default(0),
  /** Head SHA the last round was counted against, so a new push starts a new round. */
  lastRoundSha: z.string().nullable().default(null),
});

/** One agent run: what actually executed, against which vendor, at what cost. */
export const dispatchStateSchema = z.object({
  id: z.string(),
  entityId: z.string(),
  phase: z.string(),
  action: z.string(),
  vendor: z.string(),
  startedAt: z.string(),
  settledAt: z.string().nullable().default(null),
  outcome: z.enum(["completed", "failed"]).nullable().default(null),
  costUsd: z.number().nullable().default(null),
});

/**
 * Conductor's observed copy of a PR fact, with provenance.
 *
 * The copy is an asset, not a liability: it is what makes a **missed event
 * recoverable**. A comment arriving on a PR conductor never saw opened is a
 * divergence, and the divergence is how it knows to backdate the missed
 * transition. A copy with a designated winner and a reconcile path is a cache;
 * a copy without one is a second authority, which is the mistake that made the
 * earlier attempt loop forever after a cold restart.
 *
 * GitHub always wins on these fields.
 */
export const observedPrStateSchema = z.object({
  number: z.number().int(),
  entityId: z.string(),
  state: z.enum(["open", "closed", "merged"]),
  headSha: z.string(),
  checks: z.enum(["pending", "success", "failure"]).nullable().default(null),
  mergeable: z.boolean().nullable().default(null),
  baseRed: z.boolean().default(false),
  /**
   * Review ids conductor has already reduced over. Without this there is no way
   * to tell a review that arrived while the process was down from one already
   * handled, and every reconcile would re-fire every review on the PR.
   */
  knownReviewIds: z.array(z.string()).default([]),
  /** When conductor last read this, and from where. */
  observedAt: z.string(),
  provenance: z.enum(["webhook", "poll", "synthesized"]),
});

/**
 * One append-only record of a reduction: the signal that arrived, the action it
 * produced, and when. **This is what makes a transition reproducible** — the
 * invariant the whole design rests on. A model may appear anywhere upstream of
 * a signal, because its output is recorded here and replayable; it may never
 * appear where the output *is* the transition.
 */
export const ledgerEntryStateSchema = z.object({
  id: z.string(),
  entityId: z.string(),
  /** Monotonic per entity. Ordering is the ledger's job, not the store's. */
  seq: z.number().int(),
  signalKind: z.string(),
  /** True when the signal was inferred by reconciliation rather than observed. */
  signalSynthesized: z.boolean().default(false),
  actionKind: z.string(),
  phaseBefore: z.string(),
  phaseAfter: z.string(),
  gate: z.string().nullable().default(null),
  at: z.string(),
});

export type IssueState = z.infer<typeof issueStateSchema>;
export type EpicState = z.infer<typeof epicStateSchema>;
export type ArtifactState = z.infer<typeof artifactStateSchema>;
export type DispatchState = z.infer<typeof dispatchStateSchema>;
export type ObservedPrState = z.infer<typeof observedPrStateSchema>;
export type LedgerEntryState = z.infer<typeof ledgerEntryStateSchema>;

/**
 * Conductor's entities live at `org` scope: one repo's work record, durable
 * across every session and user that touches it.
 *
 * **Session scope is not an option here, and this is worth writing down because
 * it looks like one.** A tick is a short request, and the thing that fires it
 * varies: a webhook today, a cron tomorrow, a CLI invocation from an operator's
 * terminal after that. Those are *different sessions*. Anything the driver needs
 * on the next tick — the entity's phase, the observed PR copy reconciliation
 * diffs against, the ledger a transition is replayed from — would be gone by the
 * time that next tick ran, and conductor would rediscover every PR from scratch
 * on every pass. Restart-safety is the property this whole design exists to
 * buy; session scope spends it.
 *
 * `sharedToWorkstream` does not rescue this either. It gives one session and the
 * background children it spawns a single identity — a lineage, not a repo. Two
 * independent future sessions still see two empty collections.
 */
const SCOPE = "org" as const;

/** Issues under management, keyed `issues/<id>`. */
export const conductorIssues = defineResourceCollection({
  pattern: "issues/**",
  scope: SCOPE,
  stateSchema: issueStateSchema,
});

/** Epics under management, keyed `epics/<id>`. */
export const conductorEpics = defineResourceCollection({
  pattern: "epics/**",
  scope: SCOPE,
  stateSchema: epicStateSchema,
});

/** Artifacts, keyed `artifacts/<id>`. Document body lives in resource content. */
export const conductorArtifacts = defineResourceCollection({
  pattern: "artifacts/**",
  scope: SCOPE,
  stateSchema: artifactStateSchema,
});

/**
 * **There is deliberately no `reviews` collection.** GitHub owns review facts —
 * that is the same "GitHub always wins" rule the observed-PR copy is governed by
 * — and the tick already materializes them fresh into
 * `World.pullRequests[].reviews` on every pass, which is where every gate reads
 * them from. Persisting a second copy of each review would create a second
 * authority for data GitHub has already been designated the winner of: the exact
 * mistake that made the earlier attempt loop forever after a cold restart, and
 * one that grows a row per review for the life of the repo.
 *
 * The only review bookkeeping conductor needs is *which reviews it has already
 * reduced over*, and that is `observedPrStateSchema.knownReviewIds` — a list of
 * ids per PR, not a copy of the reviews themselves.
 */

/**
 * Agent runs, keyed `dispatches/<id>`.
 *
 * One row per phase execution, so this accumulates for the life of the repo.
 * Capped and LRU-evicted, which is safe here in a way it is not for the ledger:
 * a dispatch row is operational telemetry (which vendor ran, what it cost, how
 * it ended). The *transition* it produced is recorded in the ledger, so an
 * evicted dispatch costs cost-reporting history, not replayability.
 *
 * 2,000 at roughly 5–20 dispatches per issue is on the order of the last 100–400
 * issues — far longer than any open work window. LRU rather than `oldest`
 * because an in-flight dispatch is written to again when it settles, so recency
 * keeps it alive; `oldest` would pick a victim by creation time and could
 * tombstone a run that has not reported back yet.
 */
export const conductorDispatches = defineResourceCollection({
  pattern: "dispatches/**",
  scope: SCOPE,
  stateSchema: dispatchStateSchema,
  maxInstances: 2_000,
  eviction: "lru",
});

/**
 * Observed PR facts, keyed `observations/pr/<number>`.
 *
 * **Deliberately uncapped.** One small row per PR conductor has ever seen, so it
 * grows at the repo's PR rate — bounded by how fast humans and agents can open
 * PRs, orders of magnitude below the ledger.
 *
 * More to the point, eviction here is not merely lossy, it is *wrong*: this copy
 * is the baseline `reconcile` diffs against. Drop the row for a PR that is still
 * open and the next tick sees a PR it has never observed, synthesizes a
 * `pr_opened` plus a signal for every review already on it, and re-reduces
 * transitions that already happened. The correct cleanup is deletion when a PR
 * settles — a merged or closed PR can produce no further signals — not a
 * capacity policy that picks its victim by age or recency.
 */
export const conductorObservations = defineResourceCollection({
  pattern: "observations/**",
  scope: SCOPE,
  stateSchema: observedPrStateSchema,
});

/**
 * The workflow ledger, keyed `ledger/<entityId>/<seq>`.
 *
 * The highest-volume collection by far: one append per signal reduced per
 * entity, forever.
 *
 * **The cap is a tripwire, not a retention policy, and `eviction` is `"none"` on
 * purpose.** This is the audit trail the central invariant rests on — *every
 * transition is reproducible from the ledger* — and LRU or `oldest` eviction
 * would quietly falsify it, dropping precisely the early entries of an entity's
 * history while its later ones remain. A partially-replayable ledger is worse
 * than a full one and worse than an honest failure, because nothing announces
 * that it happened.
 *
 * `"none"` refuses the write instead: at the cap, appending raises rather than
 * destroying evidence, which is loud, operator-recoverable, and cannot corrupt a
 * replay. 20,000 is set where a healthy repo will not reach it (at ~10–40
 * entries per issue lifecycle it covers several hundred issues) while staying
 * small enough to bulk-load per tick, since this collection prefetches eagerly.
 *
 * **When it trips, the fix is archival — rolling settled entities' entries into
 * cold storage or a per-entity digest — not a larger number.** A cap alone can
 * only ever defer the question.
 */
export const conductorLedger = defineResourceCollection({
  pattern: "ledger/**",
  scope: SCOPE,
  stateSchema: ledgerEntryStateSchema,
  maxInstances: 20_000,
  eviction: "none",
});
