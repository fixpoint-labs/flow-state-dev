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
 * That rule is about **entities** — the things `decide` reduces *over*. The
 * ledger is not one: it is a transcript of reductions that already happened, so
 * its rows hold `decide`'s past inputs rather than its current read set. Same
 * store, different job, and the reason its `signal` and `world` fields are not
 * a violation of the line above.
 *
 * These are declarations only — `defineResourceCollection` comes from `core`,
 * so this module stays free of `engine` and M0 remains pure. Registering the
 * collections against a scope registry is M1's job.
 */

import { defineResourceCollection } from "@flow-state-dev/core";
import { z } from "zod";
import { isRetiredSignal, signalSchema } from "./signals";
import { hostedAtSchema, worldSchema } from "./world";

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
  /**
   * What the goal check has proved about this issue, `null` until one has run.
   *
   * **Conductor-owned and issue-scoped.** No source reports it — GitHub has no
   * opinion on whether a change did what the issue asked — so it has nowhere
   * else to live, and it is on the issue rather than on an artifact because a
   * multi-PR issue's assembled goal belongs to the issue and to no one of its
   * pull requests.
   *
   * `.nullable().default(null)` is BP-030 doing its job rather than a style
   * choice: every record written before this field existed parses back with the
   * verdict `null`, which reads as *the check has not run* — the honest answer
   * for a record that predates the check, and the safe one, since `null` opens
   * no merge gate.
   */
  goalCheck: z.enum(["passed", "failed"]).nullable().default(null),
  /**
   * The revision {@link issueStateSchema.goalCheck} was taken against — the half
   * that makes the verdict mean something, and the reason a merge gate can be a
   * property rather than a list of ways to invalidate a proof. See
   * `model/world`'s `goalCheckFor` for the rule, and `runtime/tick` for what
   * is recorded on each of the two routes to a verdict.
   *
   * `null` in three situations, and **all three must read as *not proved*, never
   * as proved-at-unknown-revision**: no check has run; a record written before
   * this field existed (BP-030 — the field defaults rather than the record
   * failing to parse); or a verdict whose revision is not yet knowable, because
   * the dispatch that reported it may have pushed a commit conductor has not
   * observed. The direction is the whole point — falling the other way opens a
   * merge gate on work nothing proved.
   *
   * Kept beside the verdict rather than folded into it so that a stored issue
   * written before this change still parses. A nested `{ verdict, sha }` would
   * make the pair inseparable, which is tempting, but it would also fail to read
   * back every record whose `goalCheck` is a bare string — and it buys no real
   * inseparability, since the revision has to stay nullable for the three cases
   * above. `runtime/tick`'s `persistGoalCheck` is the single writer of both, so
   * they move together where it counts.
   */
  goalCheckSha: z.string().nullable().default(null),
  /**
   * The ground {@link issueStateSchema.goalCheck} was taken on — the third part
   * of the proof, and the one that keeps a verdict from answering a question it
   * was never asked. See `model/world`'s `ProofGround` for what the two values
   * claim and `standingVerdict` for the rule that reads it.
   *
   * Defaults to `"branch"` rather than being nullable, and the direction is the
   * point (BP-030). A record written before this field existed holds a verdict
   * some dispatch reported, and every dispatch that can report one runs on the
   * phase's branch — so `"branch"` is the honest reading. It is also the safe
   * one: after a merge it reads as *not proved on the ground that matters*, so
   * the issue re-proves against the base instead of settling on a check that
   * never saw it. `"base"` would do the opposite, and settle silently.
   */
  goalCheckGround: z.enum(["branch", "base"]).default("branch"),
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

/** One phase execution: what actually ran, against which vendor, at what cost. */
export const dispatchStateSchema = z.object({
  id: z.string(),
  entityId: z.string(),
  phase: z.string(),
  action: z.string(),
  /**
   * Who executed it. A coding harness for work that needs judgment, and
   * `"conductor"` for the one execution that must not have any — a goal check,
   * whose verdict is an exit status rather than an agent's account of itself.
   */
  vendor: z.string(),
  startedAt: z.string(),
  settledAt: z.string().nullable().default(null),
  outcome: z.enum(["completed", "failed"]).nullable().default(null),
  costUsd: z.number().nullable().default(null),
  /**
   * What the execution had to say for itself, in plain terms. `null` on a row
   * written before this field, and on one still in flight.
   *
   * It is not only for failures, which is why it is not called `error`'s
   * narrower cousin: a goal check that *ran* records the exit status it saw
   * here, so "the goal passed" and "there was no goal to run" are told apart by
   * a reader of the record rather than being one indistinguishable `passed`.
   * For a failure it is the reason itself — the one place a dispatcher's
   * `error` becomes durable.
   */
  detail: z.string().nullable().default(null),
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
 * The comment half of an observation cursor — the keys conductor has already
 * reduced over, for one entity.
 *
 * The other half of that cursor is {@link observedPrStateSchema}, and the split
 * is not an accident of storage. A PR fact is an *asset*: it is what
 * `reconcile` diffs the world against, and it is a fact about the PR whichever
 * source read it. A comment key is neither — it is conductor's own bookkeeping,
 * it is namespaced by the source that minted it (`local:1:alice.1`,
 * `issue:4471`), and no diff consumes it. Attaching it to the PR rows would
 * mean attributing an opaque key back to a PR by parsing it, which is the
 * source's private format, and the seam exists precisely so that conductor does
 * not read it.
 *
 * Hence `source`: keys minted by a source are meaningless to another, so a
 * cursor written by GitHub tells a local observer nothing. Reading it back
 * under a different source is not a migration and not an error — it is an
 * entity that changed where it is read from, and the honest answer is an empty
 * cursor and one replayed pass over the comments (whose actions are idempotent).
 */
export const observationCursorStateSchema = z.object({
  entityId: z.string(),
  /** The observer that minted these keys — an `Observer`'s `source`. */
  source: z.string(),
  /** Comment keys already reduced over, verbatim as the source produced them. */
  commentKeys: z.array(z.string()).default([]),
  /** When this cursor was last written, ISO-8601. */
  at: z.string(),
});

/**
 * One append-only record of a reduction. **This is what makes a transition
 * reproducible** — the invariant the whole design rests on — and reproducible
 * is meant literally: a row carries `decide`'s three arguments whole, so
 * `decide({ id: entityId, kind: entityKind, phase: phaseBefore }, signal, world)`
 * can be re-run from the row alone and must produce `actionKind` again. A model
 * may appear anywhere upstream of a signal, because its output is recorded here
 * and replayable; it may never appear where the output *is* the transition.
 *
 * ---------------------------------------------------------------------------
 * WHY THE WHOLE WORLD, AND NOT SOMETHING SMALLER
 * ---------------------------------------------------------------------------
 *
 * The signal is the easy half: small, typed, and half of `decide`'s input.
 * Storing the world was the real choice, and it was made deliberately, because
 * the next reader will otherwise assume the strongest reading of the invariant
 * and be wrong about the storage it costs. Three cheaper options and why none
 * of them holds the claim:
 *
 * - **A content hash of the world.** Tells you two rows saw the same world and
 *   that a re-materialized world has drifted. Tells you nothing about *what* it
 *   held, so `decide` cannot be re-run and a wrong transition cannot be
 *   diagnosed. That is verification, not reproduction.
 * - **The subset the phase declared via `factsReadBy()`.** Appealing, and wrong
 *   twice. `decide` reads more than the gates declare — `world.policy` for the
 *   round budgets, `world.artifacts` to scope a PR-bound signal to its phase —
 *   and no gate declares either. And a phase with no gates (`SETTLED`,
 *   `CROSS_SPEC_REVIEW`) declares nothing at all, so its rows would carry no
 *   world. A subset that is silently short is the same overclaim in a
 *   thriftier costume.
 * - **Store the world only when it differs from the previous row's.** Halves
 *   the storage, since the rows a single tick appends share one snapshot
 *   exactly. Rejected: it makes a row interpretable only in the presence of its
 *   predecessors, so one missing row costs every row after it. A bounded
 *   storage saving is not worth an unbounded correctness cost on the one
 *   collection that exists to be trustworthy.
 *
 * So: the whole snapshot. Note that this is *not* an arbitrary blob —
 * {@link World} is already defined as "everything `decide` and every gate
 * predicate may read, and nothing else", so the whole snapshot **is** the
 * minimal sufficient projection. There is no smaller thing that still replays.
 *
 * **What it costs.** A row is a few KB once its PR has accumulated reviews, so
 * an issue's whole ledger runs to a few hundred KB — bounded by one work unit's
 * lifetime, and smaller than the spec document that issue produced.
 *
 * **This is a third copy of GitHub facts, and that is deliberate.** GitHub wins
 * on PR facts, {@link observedPrStateSchema} is the current-facts cache
 * `reconcile` diffs against, and the ledger's copy is neither: it is a
 * transcript of what was true at one instant, append-only, never read back as
 * current state and never diffed against. A copy with no claim to being current
 * cannot become a second authority.
 *
 * **A row written before these fields existed reads back with them `null`
 * (BP-030).** Such a row is *auditable* — the phase chain still proves nothing
 * moved outside a recorded action — but it is not *replayable*, and a consumer
 * must branch on that rather than assume the payload is there.
 */
export const ledgerEntryStateSchema = z.object({
  id: z.string(),
  entityId: z.string(),
  /**
   * Which phase table this row's phases belong to. Stored rather than looked up
   * on the entity, so a row reproduces its transition without reading a second
   * collection — `SETTLED` belongs to both tables and would otherwise be
   * ambiguous. `null` on a row written before the field existed.
   */
  entityKind: z.enum(["issue", "epic"]).nullable().default(null),
  /** Monotonic per entity. Ordering is the ledger's job, not the store's. */
  seq: z.number().int(),
  /**
   * The signal's kind, kept alongside the payload so a board can scan the
   * ledger without parsing every row, and so a legacy row without a payload
   * still says what arrived. When `signal` is present the two always agree, and
   * `signal` is what a replay reads.
   */
  signalKind: z.string(),
  /** True when the signal was inferred by reconciliation rather than observed. */
  signalSynthesized: z.boolean().default(false),
  /**
   * `decide`'s second argument, whole. `null` on a row written before this
   * field — and `null` on a row naming a signal kind conductor has since
   * retired, which reads back rather than throwing (`./signals`'s
   * {@link RETIRED_SIGNAL_KINDS}). `signalKind` below still says what arrived.
   */
  signal: z
    .preprocess((value) => (isRetiredSignal(value) ? null : value), signalSchema.nullable())
    .default(null),
  /** `decide`'s third argument, whole. `null` on a row written before this field. */
  world: worldSchema.nullable().default(null),
  actionKind: z.string(),
  phaseBefore: z.string(),
  phaseAfter: z.string(),
  gate: z.string().nullable().default(null),
  at: z.string(),
});

/**
 * One row per body of work conductor is managing, and the session its ticks run
 * in. The registry is an **index, not a record**: it holds where to find the
 * work, never what phase the work is in — that lives on the entity, in the
 * session, and duplicating it here would be a second authority for one fact.
 *
 * The session id is stored, not derived — the same call `SessionRecord.lineageId`
 * makes. Session identity is deletable and recreatable, so an address computed
 * from an issue key is one two ticks can compute their way to different answers
 * about; a value written once and read back is not.
 */
export const registryEntryStateSchema = z.object({
  /** Epic id, or issue id for a standalone issue running without one. */
  id: z.string(),
  kind: z.enum(["epic", "issue"]),
  /** The session every tick for this work runs in. */
  sessionId: z.string(),
  addedAt: z.string(),
});

export type IssueState = z.infer<typeof issueStateSchema>;
export type EpicState = z.infer<typeof epicStateSchema>;
export type ArtifactState = z.infer<typeof artifactStateSchema>;
export type DispatchState = z.infer<typeof dispatchStateSchema>;
export type ObservedPrState = z.infer<typeof observedPrStateSchema>;
export type ObservationCursorState = z.infer<typeof observationCursorStateSchema>;
export type LedgerEntryState = z.infer<typeof ledgerEntryStateSchema>;
export type RegistryEntryState = z.infer<typeof registryEntryStateSchema>;

/*
 * ---------------------------------------------------------------------------
 * WHERE ENTITIES LIVE
 * ---------------------------------------------------------------------------
 *
 * **One session per epic. One workstream — a child session — per issue.** Every
 * trigger for a piece of work fires a tick into that work's own session:
 * `flow.webhooks`' `sessionId(event)` routes a GitHub event into it, and a cron
 * sweep enqueues against it (`enqueueAction({ …, sessionId })`). A tick is one
 * *request*; many requests belong to one session. Three altitudes follow, and
 * each one is a different question about who has to see the data.
 *
 * | Altitude | Scope | Who sees it |
 * |---|---|---|
 * | Cross-epic | `org` | anything, including a tick that belongs to no epic |
 * | Epic-level | `session` + `sharedToWorkstream` | the epic session and every issue workstream under it |
 * | Issue-level | `session` | one workstream's own ticks |
 *
 * **The mechanism, verified rather than assumed.** A session-scoped resource
 * resolves to one of exactly two addresses (`createExecutionContext`): the
 * running session, or — with `sharedToWorkstream: true` — the lineage root.
 * `SessionRecord.lineageId` is minted by the root and inherited *verbatim* by
 * every descendant, so the lineage is flat: an issue workstream and the epic
 * session above it resolve one shared instance set, and so does anything the
 * workstream itself spawns.
 *
 * Two consequences of that flatness, both load-bearing:
 *
 * - **There is no intermediate address.** A workstream cannot share a
 *   collection with only *its* children — the choice is this session or the
 *   root. So an unshared collection is readable from the workstream's own ticks
 *   and from nothing else, including a phase execution the workstream detached.
 *   A detached phase reports back as a signal, never by writing these rows.
 * - **A standalone issue needs no special case.** With no epic above it its own
 *   session is the lineage root, so the shared collections resolve there and the
 *   model is the same one, minus a level.
 *
 * **The line between the two session altitudes: the entity graph is shared; each
 * entity's working record is local.** What exists and where it is hosted is read
 * from every altitude — an epic's cross-spec review reads its issues' artifacts,
 * the per-epic board renders the roster. An entity's observed PR copy, its
 * dispatch history, and its ledger are reduced over only by the tick that
 * produces them.
 *
 * **What org scope is left holding: the registry, and only the registry.** A
 * cron sweep runs in no epic's session — the scheduled transport dispatches with
 * no `sessionId` at all — so it cannot reach either session altitude to discover
 * what to tick. It reads the registry, then fans out one enqueue per session.
 * That is a genuinely cross-session read, and the store interface offers no
 * other kind: every resource read is addressed `(scopeType, scopeId, key)`, so
 * "query state across sessions" does not exist as a primitive. A board spanning
 * every epic is the same fan-out the devtool already does — list, then read each.
 *
 * **Org scope costs a binding.** Org-scoped resources are absent from
 * `ctx.resources` unless the request resolves an `orgId` from its principal, and
 * the CLI binds none. Conductor must run under an org-bound principal for the
 * registry to resolve — a deployment requirement the two session altitudes do
 * not carry, and the reason nothing else was left up here.
 */

/**
 * What is under management, keyed `registry/<id>`. Org-scoped — see the block
 * above for why this one collection is, and why nothing else is.
 *
 * **Capped as a tripwire, and the only capped collection here.** Everything else
 * is bounded by one epic's or one issue's lifetime; this grows with the repo's,
 * shrinking only as rows are deleted when work settles. Eviction is `"none"`
 * because dropping a row here is not lossy but *wrong*: the work stays live and
 * nothing ticks it again, silently. Refusing to take on new work is loud and
 * recoverable; abandoning work already accepted is neither. 500 is far past any
 * plausible count of concurrently managed epics, so tripping it means rows are
 * leaking rather than accumulating — and the fix is finding the missed deletion,
 * not a larger number.
 */
export const conductorRegistry = defineResourceCollection({
  pattern: "registry/**",
  scope: "org",
  stateSchema: registryEntryStateSchema,
  maxInstances: 500,
  eviction: "none",
});

/** Epic-level: the epic session and every issue workstream under it read one set. */
const EPIC_LEVEL = { scope: "session", sharedToWorkstream: true } as const;

/** Issue-level: one workstream's own ticks, and nothing else. */
const ISSUE_LEVEL = { scope: "session" } as const;

/**
 * Epics under management, keyed `epics/<id>`.
 *
 * Epic-level: an issue workstream reads the epic it runs under without a
 * cross-session hop.
 */
export const conductorEpics = defineResourceCollection({
  ...EPIC_LEVEL,
  pattern: "epics/**",
  stateSchema: epicStateSchema,
});

/**
 * Issues under management, keyed `issues/<id>`.
 *
 * Epic-level, which makes it the epic's **roster** as well as the issue entity —
 * deliberately one collection and not two. The epic's tick has to know each
 * issue's phase to know when the set has settled, and the per-epic board renders
 * exactly this. A separate roster carrying a copy of `phase` would be a second
 * place one fact lives, which is the mistake the earlier attempt died of.
 */
export const conductorIssues = defineResourceCollection({
  ...EPIC_LEVEL,
  pattern: "issues/**",
  stateSchema: issueStateSchema,
});

/**
 * Artifacts, keyed `artifacts/<id>`. Document body lives in resource content.
 *
 * Epic-level: cross-spec review reads every sibling issue's spec, so an artifact
 * has to be visible from an altitude above the workstream that produced it.
 */
export const conductorArtifacts = defineResourceCollection({
  ...EPIC_LEVEL,
  pattern: "artifacts/**",
  stateSchema: artifactStateSchema,
});

/**
 * **There is deliberately no `reviews` collection.** GitHub owns review facts —
 * that is the same "GitHub always wins" rule the observed-PR copy is governed by
 * — and the tick already materializes them fresh into
 * `World.pullRequests[].reviews` on every pass, which is where every gate reads
 * them from. Persisting a second copy of each review would create a second
 * authority for data GitHub has already been designated the winner of — which
 * is how a stored copy that disagrees with the fresh read loops forever after a
 * cold restart — and it grows a row per review for the life of the repo.
 *
 * The only review bookkeeping conductor needs is *which reviews it has already
 * reduced over*, and that is `observedPrStateSchema.knownReviewIds` — a list of
 * ids per PR, not a copy of the reviews themselves.
 */

/**
 * Agent runs, keyed `dispatches/<id>`.
 *
 * Issue-level, and **uncapped**. One row per phase execution of one entity, so
 * roughly 5–20 rows over that entity's whole lifetime. A capacity policy here
 * would be sized against every issue the repo will ever run, which is what org
 * scope pooling this collection would require; at issue level a work unit's own
 * dispatch history needs none, and carrying one would imply a growth problem
 * this shape does not have.
 */
export const conductorDispatches = defineResourceCollection({
  ...ISSUE_LEVEL,
  pattern: "dispatches/**",
  stateSchema: dispatchStateSchema,
});

/**
 * Observed PR facts, keyed `observations/pr/<number>`.
 *
 * Issue-level: one row per PR of one issue — a spec PR, an implementation PR,
 * and a multi-PR issue's sub-PRs.
 *
 * **Uncapped, and eviction here would be wrong rather than merely lossy.** This
 * copy is the baseline `reconcile` diffs against. Drop the row for a PR that is
 * still open and the next tick sees a PR it has never observed, synthesizes a
 * `pr_opened` plus a signal for every review already on it, and re-reduces
 * transitions that already happened. The correct cleanup is deletion when a PR
 * settles — a merged or closed PR can produce no further signals — not a
 * capacity policy that picks its victim by age or recency.
 */
export const conductorObservations = defineResourceCollection({
  ...ISSUE_LEVEL,
  pattern: "observations/**",
  stateSchema: observedPrStateSchema,
});

/**
 * Observation cursors, keyed `cursors/<entityId>`.
 *
 * Issue-level, and for the same reason the observed PR copy is: a cursor is the
 * working record of the ticks that reduced over it, and a tick belonging to
 * another entity has no business advancing it. One row per entity — the cursor
 * is per-entity, not per-PR, because the source hands it back as one list.
 *
 * Uncapped. One row, replaced in place, for the life of the work item.
 */
export const conductorCursors = defineResourceCollection({
  ...ISSUE_LEVEL,
  pattern: "cursors/**",
  stateSchema: observationCursorStateSchema,
});

/**
 * The workflow ledger, keyed `ledger/<entityId>/<seq>`.
 *
 * Issue-level: one append per signal this entity reduced, in the session whose
 * ticks reduced it. The highest-volume collection here, and still on the order
 * of 10–40 entries over a work unit's lifetime — each carrying the world
 * snapshot it was reduced against, so a few KB per row rather than a few
 * hundred bytes. See {@link ledgerEntryStateSchema} for why that is the right
 * trade.
 *
 * **Uncapped, deliberately, and this is the collection where that is a claim
 * rather than a shrug.** The invariant it carries is that *every transition is
 * reproducible from the ledger*, and no capacity policy is compatible with that:
 * LRU or `oldest` falsify it silently by dropping an entity's early history
 * while its later entries remain, and `"none"` at a cap converts a long-running
 * issue into a hard failure. The previous 20,000-row tripwire was answering a
 * question org scope created — every entity's history, pooled, for the life of
 * the repo. Bounded by one work unit's lifetime, the question does not arise.
 */
export const conductorLedger = defineResourceCollection({
  ...ISSUE_LEVEL,
  pattern: "ledger/**",
  stateSchema: ledgerEntryStateSchema,
});
