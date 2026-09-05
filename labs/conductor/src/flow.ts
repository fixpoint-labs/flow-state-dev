/**
 * The conductor flow — a board, one handed-off worker, and three zero-model
 * actions.
 *
 * `seed` files an issue-phase as a durable row. `wake` drains the board, which
 * claims a row and hands it to the manager in its own child session. `status`
 * reads back what happened.
 *
 * ## The board's own ledger is a deliverable, not a default
 *
 * A board that hands off refuses FOUR things at construction, and a flow that
 * leaves any of them implicit throws before `seed` can run: an explicit stable
 * `boardId`, a durable `defineTaskCollection()` backing, a ledger the child
 * session can reach, and a NAMED seat — because a hand-off is addressed by the
 * seat name the row is routed by, so an unnamed one has no address to dispatch
 * to.
 *
 * **`user`-scoped, no `sharedToLineage`.** The task row is where a human's
 * later answer lands, through a NEW request, so a parked row has to outlive the
 * coordinator session that created it. `user` rather than `org` because it
 * matches the already-user-scoped inbox where the other half of that round trip
 * arrives, while `org` would share a claim pool across users. At `user` scope
 * the `sharedToLineage` refusal never fires — it is conditional on session
 * scope — and the other two requirements still apply exactly as stated.
 *
 * **Partitioned by epic, and the partition has to reach storage.** One board
 * per epic, and each epic gets its own COLLECTION identity. A distinct
 * `boardId` is not sufficient and is not an alternative: it never reaches the
 * ledger — it is hashed into the derived child session id and framed into
 * the coordinate key — so two epic boards under one user sharing a collection
 * id and differing only in `boardId` would operate on the same rows, and one
 * epic's drain could claim or settle another's. Both ids are needed and neither
 * substitutes for the other: `boardId` names the board within a flow instance,
 * the collection identity partitions storage.
 *
 * **A named limit: a second instance registers, but nothing can address it.**
 * Two conductors carry two distinct flow ids, which is what keeps the registry
 * from rejecting the second registration — but no dispatch path resolves BY
 * that id. `FlowRegistry.get(kind, id?)` is called with one argument
 * everywhere in the engine (the HTTP action, session, stream, resume, state and
 * resource routes; the webhook route; the in-process dispatcher; the transport
 * host), and a kind-only lookup answers with the first instance registered
 * under that kind. So a second epic's conductor receives nothing: requests for
 * it land on the first, where the tenant gate or the phase guard refuses them.
 * Two epics need two hosts until dispatch carries an instance id, and making it
 * carry one is framework work rather than lab work.
 *
 * ## Why `status` is an action and not a route
 *
 * `defineTaskCollection()` exposes no `client` option, so the board ledger can
 * never declare `client.state.read` and its collection-state route answers 403.
 * And nothing else substitutes: `recordSuccess` writes with `ifAllowed: true`,
 * so a `complete()` refused on a lost claim is DROPPED rather than thrown — the
 * worker returns normally, the child session's request completes, and the run record
 * reads as a success while the board row is still open. **The board row is the
 * authority on completion; the run record never is.**
 */
import { defineFlow, dispatcher, handler, sequencer } from "@flow-state-dev/core";
import { claudeCodeAgent } from "@flow-state-dev/claude-code/sdk";
import { isAbsolute } from "node:path";
import { z } from "zod";
import {
  claimDisposition,
  defineTaskCollection,
  isClaimable,
  DEFAULT_MAX_ABANDONMENTS,
} from "@flow-state-dev/orchestration/tasks";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import {
  assertBaseRefExists,
  assertCheckoutRootUsable,
  assertDistinctRepository,
  assertPositiveInt,
  describeTenant,
  harnessDrainBudgetMs,
  harnessManager,
  harnessTaskInputSchema,
  INBOX,
  inboxCollection,
  listQuestions,
  type PhaseRunContext,
  type PhaseSpec,
  type PromptRunContext,
  readRunRow,
  type RequestIdentityContext,
  requestTenant,
  resolveOwnership,
  runRecordCollection,
  runRecordStateSchema,
  RUNS,
  runTopic,
  runTopicPrefix,
  withdrawQuestion,
  type WorkspaceConfig,
} from "@flow-state-dev/harness-manager";
import {
  assertSafeSegment,
  canonicalSegment,
  harnessTaskId,
  joinIdentity,
  sameSegment,
  tenantSegment,
} from "@flow-state-dev/harness-manager/checkout";
import { implementPhase } from "./implement";
import {
  answerInputSchema,
  answerOutputSchema,
  decideAnswer,
  type AnswerBoard,
  type AnswerOutput,
} from "./answer";

/** The one assignee this board routes to. */
export const ASSIGNEE = "harness" as const;

export interface ConductorFlowOptions {
  /**
   * The epic this board belongs to. One board per epic — it names both the
   * routing id and the storage identity, which is why it is required.
   */
  epic: string;
  /**
   * The tenant this conductor serves. **Omitted means untenanted** — which is a
   * distinct identity, not a synonym for any particular tenant name.
   *
   * Construction-time rather than per-request, because it partitions a
   * collection identity. A multi-tenant host builds one conductor per
   * (tenant, epic), and **every action refuses a request resolved to any other
   * tenant before it touches the board** — `seed` before the row is written,
   * `status` before the ledger is read, `wake` before the claim that would
   * charge an attempt. The manager checks again before executing, because a
   * task can reach the board by any route that can write a row.
   */
  tenant?: string;
  workspace: WorkspaceConfig;
  /**
   * How many attempts a row gets. Without one the substrate's default is
   * single-attempt and the retry decision 1 is priced on never happens.
   */
  maxAttempts?: number;
  runTimeoutMs?: number;
  /** Defaults to the implement phase. Swapped by tests and by later phases. */
  phase?: PhaseSpec;
  /**
   * Forwarded to the coding agent (model, tools, permission mode, a test stub).
   *
   * This lab picks Claude Code, so this is `claudeCodeAgent`'s option surface
   * minus the four the manager's slot supplies — see where the factory is
   * written below. A host that wanted Codex would write a different factory and
   * change nothing in `@flow-state-dev/harness-manager`.
   */
  agent?: Omit<
    Parameters<typeof claudeCodeAgent>[0],
    "detached" | "recordWork" | "cwd" | "resume" | "onSession"
  >;
  ownership?: Parameters<typeof harnessManager>[0]["ownership"];
  /**
   * Told, after the park, that a question exists. Defaults to a no-op.
   *
   * The seam Relay (FIX-1230) fills once it lands. Absent, an operator finds
   * the question by calling `status` rather than by being told — which is why
   * `status` reports the open rows and not only the board row.
   */
  announce?: Parameters<typeof harnessManager>[0]["announce"];
}

/** The flow's `kind`, which is how the HTTP routes address it. */
export const CONDUCTOR_FLOW_KIND = "conductor" as const;

/**
 * Does this row's payload derive the id it is filed under?
 *
 * **Attribution only, and the separation from admission is the point.** Two
 * different questions are asked about a board row and they need different
 * answers:
 *
 * - *Does this row own this run record?* — identity, and nothing else. `status`
 *   asks it, and a wrong answer misreports one task's session, cost and
 *   checkout under another's.
 * - *May `seed` reuse this row instead of filing one?* — identity AND the
 *   policy a drain would then run it under. `seedMayReuse` asks that.
 *
 * They were one predicate for exactly one round, and broadening it for the
 * second question immediately broke the first: adding the retry-budget check
 * meant a host restarted with a different `maxAttempts` reported `run: null` for
 * every row filed before the restart, hiding real recorded work behind a policy
 * comparison that has nothing to do with who owns a record. The identity is
 * unchanged in that case; only the policy moved.
 *
 * The same mistake in the other direction is already argued in the goal check —
 * the product's state rule kept apart from the check's stricter question — and
 * this file made it anyway, one round later, by merging rather than splitting.
 *
 * Every surface that attributes a row goes through THIS function: the seed's
 * pre-create lookup and race-recovery re-read (via `seedMayReuse`), the status
 * join, and by the same rule the manager's own guard before it executes. The
 * board is a shared collection and this flow states elsewhere that a task can
 * reach it by any route that can write a row, so a row whose id and payload
 * disagree is reachable — and each door that skips the check turns it into a
 * different silent wrong answer.
 *
 * **Every way the derivation can fail answers `false`, including a throw.**
 * `harnessTaskId` validates the owned-segment grammar and RAISES on a
 * violation, so a persisted row carrying `{ issue: "FIX.1" }` did not fail this
 * predicate, it failed the whole call — turning one malformed row into an error
 * for an entire `status` listing. Written as "anything other than a clean match
 * is not a match" rather than as a list of the ways it can go wrong, because the
 * list is the part that keeps coming up short.
 */
function rowOwnsItsIdentity(task: { id: string; input?: unknown }): boolean {
  const found = task.input as { issue?: unknown; phase?: unknown } | undefined;
  if (typeof found?.issue !== "string" || typeof found?.phase !== "string") return false;
  try {
    return harnessTaskId(found.issue, found.phase) === task.id;
  } catch {
    return false;
  }
}

/**
 * May `seed` treat this existing row as the one it was asked to file?
 *
 * **Identity plus everything that decides whether this row drains the way the
 * seed promises.** Attribution is not enough here: `seed` reports success and
 * the row is then DRAINED, so a row that runs under a policy nobody configured —
 * or that can never be claimed at all — makes that report a lie.
 *
 * **The frame, corrected.** One commit ago this said it was "written against
 * the `addTask` call it mirrors", and that frame is structurally blind: it can
 * only see fields `seed` SETS, and says nothing about fields `seed` leaves at
 * their default which a foreign writer can set to something harmful. `deps` is
 * exactly that, and it is how the fourth field in a row slipped past a check
 * that had just claimed to be complete. The question is not "does this match
 * what we would have written" but "can this be drained as promised".
 *
 * **Drainability is ASKED, not re-derived.** Six review rounds found six
 * separate inputs to "can a drain run this" — assignee, retry budget, `deps`,
 * `blocked`, `parked`, and a spent abandonment allowance — because this
 * function was enumerating, field by field, a question the substrate already
 * answers. `@flow-state-dev/orchestration/tasks` says so at the export:
 * `isClaimable` is THE admission predicate, and "a caller implementing
 * `TaskCollectionRef` itself should read it too rather than write a fourth
 * copy." This was the fourth copy. It now reads the original, and the class of
 * finding ends rather than the latest instance of it.
 *
 * What remains here is only what the substrate cannot know:
 *
 * - `rowOwnsItsIdentity` — is this row the task the caller asked for. The
 *   substrate has no opinion; the id is this conductor's derivation.
 * - `assignee` — which worker a drain routes to. Claimable and still useless:
 *   the claim charges an attempt and then finds no worker declared.
 * - `maxAttempts` — this conductor's retry budget, and **absent means
 *   single-attempt**, not "the default". A row filed without it turns the first
 *   failed coding run terminal on a conductor configured for retries.
 *
 * And two questions delegated whole:
 *
 * - `isClaimable` — the status and lease arm (`pending`, or `in_progress` with a
 *   lapsed lease) and `depsSatisfied`. This subsumes the parked statuses and the
 *   dependency check that used to be spelled out here.
 * - `claimDisposition` — **admission is not dispatch.** A lapsed row whose
 *   abandonment allowance is spent is admitted by `isClaimable` and then settled
 *   `errored` by the claim write instead of being handed to a worker. `seed`
 *   would report filed and no coding run would ever start.
 *
 * The terminal case is read FIRST and is the one status arm still spelled out
 * here, because it inverts the rest: `completed`, `errored` and `cancelled` are
 * not claimable, and must be admitted anyway — that is the ordinary idempotent
 * case and the public promise that a second seed returns the existing row.
 * Asking about the retry budget before it refused a finished row filed under a
 * different `maxAttempts`, using a policy that could never be applied to it as
 * grounds for rejection.
 *
 * `priority` and `labels` decide order and nothing else, and are model-patchable
 * besides.
 *
 * `assignee` is model-patchable through `updateTask` while `maxAttempts` is not
 * — so this is a statement about the row as filed, and only the latter is a
 * guarantee about it afterwards.
 */
const TERMINAL_STATUSES = new Set(["completed", "errored", "cancelled"]);

function seedMayReuse(
  task: { id: string; input?: unknown; assignee?: unknown; maxAttempts?: unknown },
  maxAttempts: number,
  now: number = Date.now(),
): boolean {
  if (!rowOwnsItsIdentity(task)) return false;

  // Terminal first, because it inverts everything below: a finished row is not
  // claimable and is admitted anyway.
  if (TERMINAL_STATUSES.has((task as { status?: unknown }).status as string)) return true;

  if (task.assignee !== ASSIGNEE) return false;
  if (task.maxAttempts !== maxAttempts) return false;

  const row = task as Task;

  // **A row that is already RUNNING is already what the seed asked for.**
  // `isClaimable` answers "can a drain take this now"; `seed` asks "does a row
  // for this task already exist and is it being worked". A live `in_progress`
  // row is the second and deliberately not the first — the substrate withholds
  // it from claiming precisely because someone has it — so delegating the whole
  // question to `isClaimable` made this conductor reject its own running row and
  // turned concurrent seeds timing-dependent: whether the second call succeeded
  // depended on whether the first drain had claimed yet.
  //
  // Checked after routing and budget, not before: a row running under another
  // assignee is somebody else's work at this id, not an idempotent hit.
  //
  // **A LEASE, not merely "not lapsed" — and the distinction is one I got
  // backwards.** `leaseLapsed` returns false for an `in_progress` row carrying
  // no lease at all, so phrasing this arm in its terms admitted that row as
  // "already running". It is the opposite: `isClaimable` rejects a lease-less
  // row too, so nobody owns it and no drain will ever start it. Reporting it as
  // started is the silent nothing-happened this whole predicate exists to stop.
  //
  // Written as a present, unexpired lease rather than as the negation of a
  // helper whose null-handling belongs to a different question.
  if (row.status === "in_progress" && row.leaseUntil != null && row.leaseUntil > now) {
    return true;
  }

  // **`() => undefined` resolves no dependency on purpose.** This conductor
  // files rows with none, so any row carrying one is not one it filed — and
  // rather than assert that separately, the lookup that cannot satisfy a
  // dependency makes `depsSatisfied` say it.
  if (!isClaimable(row, () => undefined, now)) return false;
  // Admission is not dispatch. `DEFAULT_MAX_ABANDONMENTS` is the same constant
  // the board's own claim path and wake probe use; nothing configures it per
  // board, so reading it here cannot drift from what the claim will decide.
  return claimDisposition(row, now, DEFAULT_MAX_ABANDONMENTS) === "claim";
}

/** Build the conductor flow for one epic. */
export function conductorFlow(options: ConductorFlowOptions) {
  const {
    epic,
    tenant,
    workspace: callerWorkspace,
    maxAttempts = 3,
    runTimeoutMs = 1_800_000,
    phase: callerPhase = implementPhase(),
    agent,
    ownership,
    announce,
  } = options;

  // **Validate what is retained, and retain a copy.** The caller's object was
  // held by reference, so a programmatic host could mutate `root`, `sourceRepo`
  // or `baseRef` after this function returned and every later attempt would use
  // locations nothing had checked. `assertDistinctRepository` is the guard that
  // stops a coding agent being pointed at the repository that dispatched it —
  // a guard that can be walked around after the fact is not one.
  //
  // Frozen as well as copied so the same hole cannot be reopened from inside
  // this module. The snapshot is shallow, which is all the shape needs: every
  // field is a string or a number.
  //
  // **The paths are NOT canonicalized here**, which is the other half of the
  // report and is declined deliberately. Resolving symlinks would make this
  // builder disagree with `checkoutPathFor`, which is exported and which the
  // goal runner and the tests call directly against the same config — one
  // conductor deriving two different checkout paths for one task is a worse
  // failure than the one being closed, and it is the reason the relative-path
  // guard above refuses rather than resolves. A host that retargets a symlink
  // under its own conductor is outside what this can defend.
  const workspace: WorkspaceConfig = Object.freeze({ ...callerWorkspace });
  // **Its sibling, and the previous version of this guard covered only one of
  // them.** `phase` is caller-owned validated configuration exactly as
  // `workspace` is: `phase.phase` is checked below and then feeds the task id,
  // the checkout path and both runtime phase guards. Retained by reference, a
  // host could swap `implement` for `review` after construction and leave the
  // implement prompt and completion check attached to rows both guards now
  // accept — or move it to a value construction would have refused, which then
  // fails only after a row is claimed and charged.
  //
  // Same rule-versus-instance failure this file keeps producing: the rule is
  // "validated configuration is snapshotted", and I applied it to the field the
  // report named. The two are written together now so a third cannot be missed
  // the same way.
  const phase: PhaseSpec = Object.freeze({ ...callerPhase });

  // Both ids, per epic, and neither substituting for the other.
  // The tenant is in BOTH ids for the same reason the epic is: `boardId`
  // partitions routing (it is hashed into the derived child session id),
  // the collection identity partitions storage, and neither substitutes for the
  // other.
  // **Every numeric option is validated at THIS door too.**
  //
  // `conductorFlow` is exported, so a host reaches these values without passing
  // through `positiveIntFromEnv`. Unvalidated, a `NaN` survives the ownership
  // comparisons silently and only surfaces at `AbortSignal.timeout` — after the
  // row is claimed and the checkout provisioned, once per retry. Same rule as
  // the env door, same predicate, applied where the value actually enters.
  assertPositiveInt("runTimeoutMs", runTimeoutMs);
  assertPositiveInt("maxAttempts", maxAttempts);
  if (workspace.provisionTimeoutMs !== undefined) {
    assertPositiveInt("workspace.provisionTimeoutMs", workspace.provisionTimeoutMs);
  }
  for (const [key, value] of Object.entries(ownership ?? {})) {
    if (value !== undefined) assertPositiveInt(`ownership.${key}`, value as number);
  }

  // **And the git inputs at this door too, which numbers alone were not.**
  //
  // The block above already argued why an exported builder has to re-check what
  // the env door checks. That argument was then applied to the numbers and
  // stopped there, which is the same rule-versus-instance failure this branch
  // has now hit four times: the door was correctly identified, and only one of
  // the rules that use it was carried through it.
  //
  // The repository guard is the one that matters. `fsdev.config.ts` and the goal
  // runner both refuse a `sourceRepo` that IS the dispatcher's own repository —
  // by repository identity, so a different path inside it, a sibling worktree or
  // a symlink is caught too. Reached through `conductorFlow` none of that ran,
  // and a seeded task would point a real coding agent at the repository that
  // dispatched it. That is obligation A, and this was the one door left open on
  // it.
  //
  // `baseRef` and the repository's existence are the cheaper half: permanent
  // configuration errors that `provisionCheckout` would otherwise discover after
  // the row is claimed, once per retry, until the budget is gone.
  // **Every path in the config is absolute, and the check is written over the
  // SET rather than over one field.** A relative path is resolved against
  // `process.cwd()` at the moment it is used, so a long-lived host that changes
  // directory turns one durable task into two different answers: a relative
  // `root` sends a retry to a different, empty checkout while the uncommitted
  // work its own prompt tells it to continue from sits in the first, and a
  // relative `sourceRepo` is validated here against one repository and handed to
  // `git` against another — possibly the dispatcher's own, which is precisely
  // what the next line refuses. Both are silent, and both are stable per
  // directory and stably wrong across two.
  //
  // Written as a loop because the first version of this guard covered `root` and
  // not `sourceRepo` — the same rule-versus-instance failure named three
  // paragraphs down, committed *while adding a guard against it*. A third path
  // field would have been missed the same way; now it cannot be.
  //
  // Refused rather than resolved-and-retained: `checkoutPathFor` is exported and
  // the goal runner and tests call it directly, so a value normalised inside this
  // builder would leave every other caller reading `cwd` exactly as before.
  for (const field of ["root", "sourceRepo"] as const) {
    if (!isAbsolute(workspace[field])) {
      throw new Error(
        `[conductor] workspace.${field} is relative (${workspace[field]}). Pass an absolute ` +
          `path: a relative one is resolved against the process's working directory each time ` +
          `it is used, so one durable task can resolve to two different locations.`,
      );
    }
  }

  assertDistinctRepository("workspace.sourceRepo", workspace.sourceRepo);
  assertBaseRefExists(workspace.sourceRepo, workspace.baseRef, "workspace.baseRef");
  // The remaining half of the same rule. The two lines above reach the
  // filesystem with `sourceRepo`, so an unusable one fails here; `root` had
  // only its spelling checked, and its failure landed after a claim instead.
  assertCheckoutRootUsable(workspace.root, "workspace.root");

  // **The phase NAME is an identity segment, and `epic` was the only one being
  // validated here.** Both feed `harnessTaskId`, the checkout path and the
  // branch; `epic` is checked where the board id is built and the phase was
  // checked nowhere, so a conductor configured with `review.v2` or `""`
  // constructed without complaint and then threw from every `seed`. Worse
  // through the other door: a matching row written straight to the shared board
  // is CLAIMED and charged before the manager reaches the same failure — a
  // permanent configuration error paid for once per retry, which is what every
  // guard at this door exists to stop.
  //
  // The return value is deliberately discarded. What is wanted here is the
  // refusal; the canonical form is derived where it is used, and callers compare
  // through `sameSegment` so nothing depends on this call folding anything.
  assertSafeSegment("phase", phase.phase);

  // The phase's own preconditions, at the same door and for the same reason —
  // see `PhaseSpec.validate`. Last, because a phase's requirements are stated in
  // terms of a repository the checks above have already established is real.
  if (tenant === "") {
    throw new Error(
      "[conductor] tenant is an empty string. Omit it for an untenanted conductor, or " +
        "pass the tenant id — an empty one derives a tenanted identity that every " +
        "request, resolving an empty tenant as untenanted, is then refused against.",
    );
  }

  // **The phase's own preconditions are the MANAGER's door now**, not this one.
  // They used to be wired here, which meant a host building a manager directly
  // — the documented way — skipped them. `harnessManager` runs `validate` and
  // binds what it returns into both run contexts; this builder passes the phase
  // through and no longer wraps it.

  // **An empty tenant is a mistake, and refusing it is not the same as
  // normalizing it.**
  //
  // `tenantSegment` reads `undefined` as untenanted and anything else as a
  // present tenant, so `""` derives a TENANTED board and run identity. Every
  // request resolves the other way — `runPrincipal` and the HTTP extractor both
  // read an empty tenant as untenanted — so the gate refuses every `seed`,
  // `wake` and `status` against a conductor that built without complaint. A
  // configuration that constructs and then fails at every door is the silent
  // wrong answer this lab exists to remove.
  //
  // Refused rather than normalized to `undefined`, which was the other option.
  // Normalizing would make `tenant: ""` and an omitted tenant the same
  // conductor — collapsing a config that SAYS it is tenanted onto the
  // untenanted identity, which is the aliasing the tenant partition exists to
  // prevent. The host meant one of the two; it should say which.
  //
  // Not a grammar. Tenant ids are unrestricted strings and are encoded rather
  // than validated for the reasons in `encodeSegment`. This is the one case the
  // encoding cannot express: present-but-empty, where `tenantSegment` already
  // spends `undefined` on absent.

  // `tenantSegment`, not `encodeSegment(tenant ?? something)`. The board and
  // the checkout MUST agree on what a tenant is, and the way they stopped
  // agreeing was a default here that the checkout did not share.
  const boardId = joinIdentity("conductor", tenantSegment(tenant), assertSafeSegment("epic", epic));
  // **The tenant is in the collection identity, not just the epic.**
  //
  // User scope is keyed on the BARE user id — `createExecutionContext` passes
  // `scopeId: userId` — while session scope tenant-qualifies its key. So two
  // tenants sharing a user id share every `user`-scoped collection, and the
  // board is one: one tenant's `wake` could claim a row another tenant filed and
  // run that task in the claiming tenant's workspace, with status and retry
  // accounting shared.
  //
  // Conductor owns this identity, which is the lever that already carries the
  // epic — so the tenant goes in the same place rather than reaching for a
  // framework change. It has to be construction-time because a collection id is:
  // a multi-tenant host builds one conductor per (tenant, epic).
  //
  // **Partitioning is only half of it.** A separate collection isolates nothing
  // unless the tenant is actually checked on the way in, and this sentence used
  // to claim the manager did that — which was true for one action of three. The
  // gate is `assertRequestTenant`, and every action passes it before any board
  // access; see its note for what each one leaked without it.
  //
  // **This partitions the run record too, for free.** The run topic leads with
  // this id, so putting the tenant here puts it in both keys — one change, one
  // rule, both stores.
  const collectionId = joinIdentity(
    "conductor-tasks",
    tenantSegment(tenant),
    assertSafeSegment("epic", epic),
  );

  const tasks = defineTaskCollection({
    id: collectionId,
    scope: "user",
    stateSchema: harnessTaskInputSchema,
  });

  const manager = harnessManager({
    boardCollectionId: collectionId,
    boardCollection: tasks,
    tenant,
    phase,
    workspace,
    runTimeoutMs,
    // **The slot, and the only place this repository names a coding harness.**
    //
    // The manager hands down three feeds and knows nothing else about what it
    // is driving; everything Claude-specific is written here, where it belongs.
    // Pointing this board at Codex is this one expression.
    //
    // `detached: true` is not decoration: the harness becomes a child block of
    // the flow's gated task entry, and the claim gate refuses an entry that
    // authors session state anywhere beneath it. A non-detached harness fails
    // at `defineFlow`, naming the entry.
    //
    // `recordWork: true` keys the index of what the run touched to the run's
    // own checkout — the other half of `cwd`, and doing only the first is the
    // trap the option's own doc names.
    harness: ({ cwd, resume, onSession }) =>
      claudeCodeAgent({
        ...(agent ?? {}),
        cwd,
        resume,
        onSession,
        detached: true,
        recordWork: true,
      }),
    ...(ownership !== undefined ? { ownership } : {}),
    ...(announce !== undefined ? { announce } : {}),
  });

  const board = taskBoard({
    name: boardId,
    boardId,
    collection: tasks,
    // ONE issue at a time, stated rather than inherited. The substrate's default
    // is 4, so a single drain would launch four handed-off coding runs at once —
    // contradicting this lab's own deployment contract and multiplying model
    // spend by four. The manager holds a worker slot for its run's whole
    // duration, so this is also what keeps that cost legible.
    concurrency: 1,
    workers: {
      // Hands off: each row runs in a child session of its own, keyed on the
      // task id — which IS the issue-phase (`harnessTaskId`), so a retry
      // re-enters the same child and its run record. The block that runs
      // there is the manager, declared on the flow's `task.actions` below.
      [ASSIGNEE]: dispatcher({
        name: `${boardId}-hand-off`,
        type: "task",
        target: ASSIGNEE,
        session: "per-task",
      }),
    },
    // **A run parked on a person is not this drain's to wait on.**
    //
    // Without it the drain holds its launching request open on the parked row
    // until it runs out its iteration budget, and then returns with the row
    // abandoned where it sits — worse than a hang, because it reports
    // `blocked-by-failures` on a board with no failures. With it, the drain
    // returns `parked-for-review`, the row stays parked and durable, and the
    // drain `answer` runs later is what picks it up.
    //
    // Its three construction refusals are all satisfied here, and each was
    // confirmed rather than assumed: the ledger is a `defineTaskCollection()`
    // (a request-backed one is refused); `onIdle` is left at its default
    // `complete-or-blocked` (both `wait` and `complete` are refused); and this
    // board seeds through the `seed` action rather than `initialTasks`, so the
    // stable-id refusal never fires. Every refusal throws at construction, so
    // getting this wrong fails before `seed` can run.
    onReview: "exit",
  });

  const seedInput = harnessTaskInputSchema;

  /**
   * File one issue-phase as a durable row, with its retry budget on it.
   *
   * **Idempotent per issue-phase**, because everything downstream already is.
   * Two rows for one issue-phase derive the same checkout, the same branch and
   * the same `runs/<epic>/<issue>/<phase>` record — so a duplicated `seed` charges two
   * full coding runs whose independently valid claims overwrite one shared run
   * record, and `status` then answers with two board rows carrying the last
   * writer's metadata. The task id is therefore the issue-phase itself rather
   * than a fresh mint, and a second `seed` returns the existing row.
   *
   * The id is built from the same validated segments the checkout path is, so
   * it cannot carry a separator or a traversal into the ledger's key space.
   */
  const seedTask = handler({
    name: "conductor-seed-task",
    inputSchema: seedInput,
    outputSchema: z.object({ taskId: z.string() }),
    uses: [board.capability],
    execute: async (input, ctx) => {
      // One board, one phase. Refused here so the mistake surfaces at the call
      // that made it rather than as a row that runs the wrong phase's prompt —
      // the manager refuses it too, since a task can reach the board by any
      // route that can write a row.
      // Canonically, for the reason the manager's copy of this guard gives —
      // and this site was not reported. It is the sibling of the one that was,
      // and the enumeration is what keeps coming up short: `sameSegment` is the
      // comparison every identity guard on this board now uses, so a sixth door
      // has something to call rather than a `!==` to write.
      if (!sameSegment(input.phase, phase.phase)) {
        throw new Error(
          `[conductor] this board runs the "${phase.phase}" phase; refusing to file a ` +
            `"${input.phase}" row. A conductor runs one phase, and the board identity is ` +
            `(tenant, epic) — so a second phase needs its own \`epic\`, NOT a second ` +
            `conductor on this one. Two conductors sharing an epic share this board: the ` +
            `other one's \`wake\` claims these rows, refuses them on phase, and charges a ` +
            `valid task an attempt for the mistake.`,
        );
      }

      const taskId = harnessTaskId(input.issue, input.phase);
      const existing = await ctx.cap[boardId].getTask(taskId);
      if (existing !== undefined) {
        // **Idempotent means "this row IS the one asked for", not "a row exists
        // at that id".** The id is derived from the issue and phase, so the two
        // normally agree — but the board is a shared collection, and this file
        // already assumes elsewhere that a task can reach it by any route that
        // can write a row. A row filed at this id carrying a different payload
        // would otherwise be reported as a successful seed: the next drain
        // claims the foreign row, charges it an attempt, and the manager's own
        // id guard then refuses it — while the task the caller actually asked
        // for was never filed at all. A silent nothing-happened, paid for by
        // somebody else's retry budget.
        //
        if (!seedMayReuse(existing, maxAttempts)) {
          throw new Error(
            `[conductor] a row already exists at "${taskId}" and it is not one this ` +
              `conductor filed — its payload does not describe ${input.issue}/${input.phase}, ` +
              `it is routed to an assignee other than "${ASSIGNEE}", its retry budget is ` +
              `not the ${maxAttempts} this conductor configures, or it carries dependencies ` +
              `that would keep it unclaimable, or a parked status a drain never ` +
              `admits. Refusing to report ` +
              `this seed as filed: draining that row charges it an attempt and then finds ` +
              `nothing to run it, and the task asked for here would never exist.`,
          );
        }

        // Already filed, and filed for this. `wake` is what re-drains it —
        // re-seeding must not mint a second run, and must not reset the retry
        // budget of the first.
        await ctx.sequencer?.patchState({ taskId: existing.id });
        return { taskId: existing.id };
      }

      // **The read above does not make this safe on its own.** Two concurrent
      // seeds can both find the row absent before either creates it; the loser's
      // create then fails on the id that already exists. Losing that race is the
      // correct outcome — one row was filed — so the loser re-reads and returns
      // the winner's row rather than surfacing a conflict the caller cannot act
      // on.
      //
      // Read-then-create is not atomic and cannot be made so through this
      // surface; the stable id is what turns the race into a *detectable*
      // conflict rather than two rows, and this turns the detection into the
      // idempotent answer.
      try {
        const task = await ctx.cap[boardId].addTask({
          id: taskId,
          goal: `Drive ${input.issue} through its ${input.phase} phase.`,
          assignee: ASSIGNEE,
          // The typed payload. NEVER `metadata`: that is model-patchable through
          // `updateTask`, and the checkout path is derived from these two fields.
          input: { issue: input.issue, phase: input.phase },
          // Without this the substrate is single-attempt and a reported failure
          // costs nothing and delivers nothing — the defect this lab exists to fix.
          maxAttempts,
          // A readable label for the row. The child session is keyed on the
          // task id (`session: "per-task"`), so nothing routes on this and
          // nothing derives a path or a permission from it.
          metadata: { topic: `${input.issue}/${input.phase}` },
        });
        await ctx.sequencer?.patchState({ taskId: task.id });
        return { taskId: task.id };
      } catch (err) {
        // Only a lost race is absorbed. Anything else — a malformed task, a
        // store outage — is a real failure and must not be reported as a
        // successful seed.
        const raced = await ctx.cap[boardId].getTask(taskId);
        if (raced === undefined) throw err;
        // **The winner of the race gets the same interrogation as a row found
        // before it.** The check one branch up was added first and stopped
        // there — but the row reached through this catch is trusted for exactly
        // the same thing, and a foreign row can be inserted between the lookup
        // and the create as easily as before it. Reporting it as this seed's
        // answer files nothing and hands the drain somebody else's task.
        if (!seedMayReuse(raced, maxAttempts)) {
          throw new Error(
            `[conductor] the create at "${taskId}" lost to a row this conductor did not ` +
              `file — wrong payload for ${input.issue}/${input.phase}, an assignee other ` +
              `than "${ASSIGNEE}", a retry budget that is not ${maxAttempts}, or dependencies ` +
              `that would keep it unclaimable, or a parked status. Refusing ` +
              `to report this seed as filed: the task asked ` +
              `for here would never exist.`,
          );
        }
        await ctx.sequencer?.patchState({ taskId: raced.id });
        return { taskId: raced.id };
      }
    },
  });

  /** Hand the seeded task id back as the action's output. */
  const returnTaskId = handler({
    name: "conductor-return-task-id",
    inputSchema: z.unknown(),
    outputSchema: z.object({ taskId: z.string() }),
    execute: (_input, ctx) => {
      const taskId = (ctx.sequencer?.state as { taskId?: unknown } | undefined)?.taskId;
      if (typeof taskId !== "string" || taskId === "") {
        throw new Error(
          "[conductor] seed completed without recording a task id — the row was filed but " +
            "the caller cannot name it.",
        );
      }
      return { taskId };
    },
  });

  /**
   * What `status` answers with. The board row leads, because it is the
   * authority on completion.
   */
  const statusOutput = z.object({
    rows: z.array(
      z.object({
        taskId: z.string(),
        issue: z.string().nullable(),
        phase: z.string().nullable(),
        /** The BOARD's status. Never inferred from the run record. */
        status: z.string(),
        attempts: z.number(),
        feedback: z.string().nullable(),
        /**
         * The run's own row, **as the schema declares it** rather than as a
         * hand-listed subset.
         *
         * A projection enumerated here would drift the moment a field is added
         * to the row — silently, and only for readers of that one field. That
         * is the same shape of defect the clearing rule exists to prevent, so
         * it is removed the same way: there is one list, and this is not a
         * second copy of it.
         */
        run: runRecordStateSchema.nullable(),
        /**
         * The questions this issue-phase is waiting on, oldest first.
         *
         * **This is how an operator sees a question with no UI built and with
         * Relay absent**, which is the whole reason `status` grew a second
         * half. Open rows only: an answered or withdrawn one is history, and
         * the two ledgers stay independent — the board row is the authority on
         * the job's state and the inbox row on the question's, neither inferred
         * from the other.
         */
        questions: z.array(
          z.object({
            /** The row's name — pass this verbatim to `answer`. */
            question: z.string(),
            /** What the run actually asked. */
            text: z.string(),
            /** Which attempt asked it. */
            attempt: z.number(),
            askedAt: z.number().nullable(),
          }),
        ),
      }),
    ),
  });

/** Board statuses from which a question can never be answered. */
const TERMINAL_TASK_STATUSES = new Set(["completed", "errored", "cancelled"]);

  /**
   * **The tenant gate. Every action passes it before touching the board.**
   *
   * The tenant is resolved from the request's own authenticated principal —
   * never from a body, a payload, or task metadata (BP-031) — and compared to
   * the one this conductor was constructed for.
   *
   * It used to live only inside the manager, which runs when the drain
   * *dispatches a claimed row*. That left the guarantee this file documents
   * untrue for two of the three actions and too late for the third:
   *
   * - `seed` wrote a row with no tenant check at all — cross-tenant task
   *   injection.
   * - `status` read the ledger with no tenant check at all — cross-tenant
   *   status disclosure.
   * - `wake` claimed first and refused after. `applyClaimToTask` sets
   *   `in_progress` and increments `attempts` in one write, so a refused
   *   cross-tenant wake still burnt an attempt on another tenant's valid task.
   *   Refusing is not enough; it has to refuse *before the claim*.
   *
   * A partition only isolates if the tenant is actually checked, and the
   * collection identity carrying the tenant is what makes this the whole of the
   * isolation rather than half of it.
   *
   * The manager keeps its own copy of this check. Not redundancy: a task can
   * reach the board by any route that can write a row, so the gate guards the
   * actions and the manager guards the execution.
   */
  function assertRequestTenant(ctx: RequestIdentityContext): void {
    const resolved = requestTenant(ctx);
    if (resolved !== tenant) {
      throw new Error(
        `[conductor] this conductor serves ${describeTenant(tenant)}; the request resolved ` +
          `to ${describeTenant(resolved)}. Refusing before reading or writing the board, ` +
          `rather than running one tenant's task in another's workspace.`,
      );
    }
  }

  /**
   * The gate as a step, so `seed` and `wake` refuse before the drain claims.
   *
   * A `.tap()` and not a `.step()`: it inspects the request and passes the
   * chain value through untouched.
   */
  const tenantGate = handler({
    name: "conductor-tenant-gate",
    inputSchema: z.unknown(),
    // `void`, not the input echoed back. `.tap()` already preserves the chain
    // value and ignores what this returns, so returning the input would be an
    // identity handler — a step that exists only to satisfy a type
    // (AGENTS.md 5). The gate's whole job is the throw.
    outputSchema: z.void(),
    execute: (_input, ctx) => {
      assertRequestTenant(ctx);
    },
  });

  const readStatus = handler({
    name: "conductor-status",
    inputSchema: z.object({ issue: z.string().optional() }),
    outputSchema: statusOutput,
    uses: [board.capability],
    resources: { [RUNS]: runRecordCollection, [INBOX]: inboxCollection },
    execute: async (input, ctx) => {
      // Before the listing, not after it — a refusal that has already read the
      // rows has already disclosed them.
      assertRequestTenant(ctx);
      const tasksOnBoard = await ctx.cap[boardId].listTasks();
      const rows = [];
      for (const task of tasksOnBoard) {
        const payload = harnessTaskInputSchema.safeParse(task.input);
        const issue = payload.success ? payload.data.issue : null;
        const phaseName = payload.success ? payload.data.phase : null;
        // **Compare the canonical form on both sides.** Identity derivation folds
        // case (`assertSafeSegment`), so seeding `FIX-1` and seeding `fix-1`
        // resolve the same row — but a raw comparison here then hid that row
        // from `status({ issue: "fix-1" })` while `seed` kept returning it. One
        // surface folding and the other not is a silent partial answer: an
        // empty listing for a task that exists and is running.
        if (
          input.issue !== undefined &&
          (issue === null || canonicalSegment(issue) !== canonicalSegment(input.issue))
        ) {
          continue;
        }

        // **The run record is attached only to a row that owns it.** The topic
        // is derived from the PAYLOAD, and the row's id is not consulted — so a
        // row filed under a non-canonical id while carrying another task's
        // `{ issue, phase }` is reported with that task's session, cost,
        // checkout and outcome. The manager refuses to execute such a row, which
        // is what makes this reachable rather than theoretical: the malformed row
        // sits there permanently, and `status` narrates somebody else's run over
        // it. Every field would be real and attributed to the wrong task.
        //
        // Left as `null` rather than refused, because this is a read surface: a
        // caller asking what is on the board should see the malformed row exists,
        // and see that nothing is known about its run. Throwing would hide the
        // whole listing behind one bad row.
        // One reading, used by both reads below: a row that does not own its
        // identity cannot have its topic or its inbox key derived, because both
        // go through the owned-segment grammar and it RAISES.
        const owns = issue !== null && phaseName !== null && rowOwnsItsIdentity(task);

        const record = owns
          ? await readRunRow(ctx, runTopic(collectionId, issue, phaseName))
          : undefined;

        // **`status` RECONCILES what it reads.** The board's `cancel` writes the
        // task row and nothing else — the manager never runs again, so neither
        // of its withdrawal arms ever fires — and the `answer` guard refuses a
        // terminal task, so the question is unanswerable by construction. Left
        // alone it shows here forever as a question nobody can act on.
        //
        // Reconciling at the READ rather than wrapping the board's `cancel` is
        // deliberate: an operator can cancel through the board's own verb, so a
        // conductor `cancel` wrapper is a step that can be bypassed, while the
        // only surface that can DISPLAY a stranded row is the one that clears
        // it. The `answer` guard does the same on its way to refusing. Both
        // writes are the ordinary forward-only withdraw, so running either twice
        // is a read.
        const questions = [];
        // **Guarded exactly as the run record above is, and for the same
        // reason.** `listQuestions` builds the inbox key through the same
        // grammar, so a malformed neighbour raised here and took the whole
        // listing with it — the failure this surface's own comment says it
        // exists to prevent. The guard was applied to one of the two reads.
        if (owns) {
          const terminal = TERMINAL_TASK_STATUSES.has(task.status);
          for (const row of await listQuestions(ctx as never, issue, phaseName)) {
            if (row.state.status !== "open") continue;
            if (terminal) {
              await withdrawQuestion(ctx as never, row.topic);
              continue;
            }
            questions.push({
              question: row.topic,
              text: row.state.question,
              attempt: row.attempt,
              askedAt: row.state.askedAt,
            });
          }
        }

        rows.push({
          taskId: task.id,
          issue,
          phase: phaseName,
          status: task.status,
          attempts: task.attempts,
          feedback: task.feedback ?? null,
          // The whole row, not a re-listing of it — see the output schema.
          run: record ?? null,
          questions,
        });
      }
      return { rows };
    },
  });

  /**
   * Answer a question, re-queue the run, and drain — the operator's one verb.
   *
   * The decision, the guard and the recovery rule live in `./answer`; this is
   * the wiring. Two things about the shape are load-bearing:
   *
   * - **The drain is a real step of this action**, gated on the decision. Not a
   *   call the handler makes: `board.drain` is the board's own sequencer, and
   *   running it as a step is what makes the re-dispatch a genuine drain of this
   *   board in this request rather than a second entry point into its machinery.
   * - **`.tapIf` and not `.stepIf`** (BP-036): the drain's output must not
   *   replace the chain value, because the chain value is what the operator gets
   *   back — the decision and its reason.
   */
  const answerQuestionStep = handler({
    name: "conductor-answer",
    inputSchema: answerInputSchema,
    outputSchema: answerOutputSchema,
    uses: [board.capability],
    resources: { [INBOX]: inboxCollection },
    execute: async (input, ctx) => {
      // Before the board is read and before the row is written, like every
      // other action: a refusal that has already disclosed a question, or
      // already applied an answer, is not a refusal.
      assertRequestTenant(ctx);
      const tasks = await ctx.cap[boardId].tasks();
      const surface: AnswerBoard = {
        get: (id) => tasks.get(id),
        unpark: (id, feedback) => tasks.unpark(id, feedback),
        // The collection's own clock, never `Date.now()` — a lease is a
        // comparison and a comparison needs one clock. Reading the wall clock
        // works right up until the collection is built on an injected one, at
        // which point a live task reads as abandoned and an abandoned one as
        // live: exactly the distinction the recovery rule's third arm turns on.
        now: () => tasks.now(),
      };
      return decideAnswer(ctx as never, surface, input);
    },
  });

  const defineConductor = defineFlow({
    kind: CONDUCTOR_FLOW_KIND,
    // The task entry the board's seat hands off to: the manager, reached by
    // the `task` dispatch the drain sends for each claimed row. `defineFlow`
    // puts it behind the board's claim gate; the flow, not the board, owns
    // what a task dispatch can reach.
    task: { actions: { [ASSIGNEE]: { block: manager } } },
    actions: {
      /** File an issue-phase and start it in one call. */
      seed: {
        block: sequencer({
          name: "conductor-seed",
          inputSchema: seedInput,
          outputSchema: z.object({ taskId: z.string() }),
          stateSchema: z.object({ taskId: z.string().nullable().default(null) }),
        })
          // First, before the row is written: seeding is a WRITE, so a check
          // that ran after it would be reporting an injection rather than
          // preventing one.
          .tap(tenantGate)
          .tap(seedTask)
          // The drain claims the row and hands it to a child session, then returns
          // with the row still open. The seeding request does not wait for the
          // run — which is the point.
          .step(board.drain)
          // **The action answers with the task id, not the drain's output.**
          // `.tap()` discards what `seedTask` returned and the drain replaces the
          // chain value, so without this the caller got `undefined` — and a
          // caller cannot follow up on a row it cannot name. It also made the
          // concurrent-idempotency test pass for the wrong reason: both reads
          // were `undefined`, so "both seeds named one row" held vacuously.
          .step(returnTaskId),
      },
      /**
       * Drain again: claim whatever is ready, including a re-pended retry.
       *
       * **Every drain conductor runs must name the coordinator session.**
       * `createExecutionContext` defaults an absent `sessionId` to a fresh
       * `ephemeral_…` value, which becomes the scope id for session-scoped
       * state — so a drain that omits it resolves a different ledger, finds an
       * empty board, and reports success having reached nothing. This board is
       * `user`-scoped so its ledger is not the exposure, but the failure looks
       * like nothing happened either way. A requirement on the caller, stated
       * rather than assumed; `answer` inherits it by running its drain inside
       * its own request.
       */
      wake: {
        // **Wrapped, so the gate runs before the claim.** A bare `board.drain`
        // claimed the row and let the manager refuse afterwards — and the claim
        // write is what increments `attempts`, so the refusal arrived one
        // charged attempt too late, on a task belonging to someone else.
        block: sequencer({
          name: "conductor-wake",
          inputSchema: z.unknown(),
          outputSchema: z.unknown(),
        })
          .tap(tenantGate)
          .step(board.drain),
      },
      /** The read surface. Zero-model, server-side, board row first. */
      status: { block: readStatus },
      /**
       * Answer a parked run's question and start it again holding the answer.
       *
       * **The drain is this action's**, not the operator's next step.
       * `unpark` only re-queues the row, and with `onReview: "exit"`
       * the drain that observed the question has already ended — so an `answer`
       * that stopped after two calls would leave the row waiting for whatever
       * happens to drain next.
       */
      answer: {
        block: sequencer({
          name: "conductor-answer-question",
          inputSchema: answerInputSchema,
          outputSchema: answerOutputSchema,
        })
          .step(answerQuestionStep)
          // Only when the decision actually authorized it. A drain is NOT a
          // no-op — on a `pending` row it claims and dispatches — so a
          // declined answer must not run one.
          .tapIf((outcome: AnswerOutput) => outcome.drained, board.drain),
      },
    },
  });

  // **The instance id is the BOARD's identity, not a constant.** "One board per
  // epic, so there is nothing to choose" is true of a single conductor and was
  // written as if it were true of the host. It is not: `createFlowState`
  // registers every flow it is given and `FlowRegistry.register` rejects a
  // duplicate `(kind, id)`, so a second conductor — which the README tells you
  // to build, since a second phase needs its own `epic` — threw at construction
  // and the host could not start at all.
  //
  // `boardId` already carries `(tenant, epic)` through the owned-segment
  // grammar, so it is unique exactly where the board is and needs no new
  // derivation. Lookup by kind alone is unaffected: `FlowRegistry.get(kind)`
  // falls back to the first instance of that kind, which is what the CLI path
  // (`fsdev run conductor status`) uses.
  const flow = defineConductor({ id: boardId });

  // **The host's shutdown budget, derived rather than guessed.** Exposed
  // because only this module knows all four terms a worker spends, and a host
  // that picks its own number picks it from the one term it can see.
  const drainBudgetMs = harnessDrainBudgetMs({
    runTimeoutMs,
    provisionTimeoutMs: workspace.provisionTimeoutMs,
    ownershipWaitMs: resolveOwnership({
      runTimeoutMs,
      provisionTimeoutMs: workspace.provisionTimeoutMs,
      ...(ownership !== undefined ? { ownership } : {}),
    }).ownership.waitMs,
  });

  return {
    flow,
    board,
    tasks,
    boardId,
    collectionId,
    runs: runRecordCollection,
    drainBudgetMs,
  };
}

export { runTopic, runTopicPrefix };
