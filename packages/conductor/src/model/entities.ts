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
 * - **content → `ContentStore`.** The prose: a spec document, a review's body,
 *   a retrospective. Free-form, and never read by `decide`.
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

/**
 * One review round against an artifact, by one reviewer. The reviewer's prose
 * is the resource's **content**; the state carries only what a gate reads.
 */
export const reviewStateSchema = z.object({
  id: z.string(),
  artifactId: z.string(),
  reviewer: z.string(),
  /** False for bots and for conductor's own identity — such reviews never satisfy a gate. */
  isHuman: z.boolean(),
  state: z.enum(["COMMENTED", "CHANGES_REQUESTED", "APPROVED"]),
  sha: z.string(),
  at: z.string(),
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
export type ReviewState = z.infer<typeof reviewStateSchema>;
export type DispatchState = z.infer<typeof dispatchStateSchema>;
export type ObservedPrState = z.infer<typeof observedPrStateSchema>;
export type LedgerEntryState = z.infer<typeof ledgerEntryStateSchema>;

/**
 * Conductor's entities live at `org` scope: one repo's work record, durable
 * across every session and user that touches it. A session-scoped entity would
 * vanish the moment the operator's conversation ended, which is the opposite of
 * what a multi-day issue needs.
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

/** Reviews, keyed `reviews/<id>`. Reviewer prose lives in resource content. */
export const conductorReviews = defineResourceCollection({
  pattern: "reviews/**",
  scope: SCOPE,
  stateSchema: reviewStateSchema,
});

/** Agent runs, keyed `dispatches/<id>`. */
export const conductorDispatches = defineResourceCollection({
  pattern: "dispatches/**",
  scope: SCOPE,
  stateSchema: dispatchStateSchema,
});

/** Observed PR facts, keyed `observations/pr/<number>`. */
export const conductorObservations = defineResourceCollection({
  pattern: "observations/**",
  scope: SCOPE,
  stateSchema: observedPrStateSchema,
});

/** The workflow ledger, keyed `ledger/<entityId>/<seq>`. */
export const conductorLedger = defineResourceCollection({
  pattern: "ledger/**",
  scope: SCOPE,
  stateSchema: ledgerEntryStateSchema,
});
