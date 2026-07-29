/**
 * epic-wake — one wake of the epic-lifecycle coordinator, as deterministic control flow.
 *
 * NOT RUNNABLE STANDALONE. This is a Claude Code **Workflow script**, not an ESM module: the
 * harness injects `agent` / `parallel` / `pipeline` / `log` / `phase` / `args` / `budget` /
 * `workflow` as globals and wraps the body in an async function, so the top-level `return`
 * below is legal here and illegal in a plain module. It has no imports and no filesystem.
 * The contract is summarized in `docs/contributing/orchestration.md` → "The workflow-script
 * contract"; `.agents/workflows/verify.mjs` mirrors it to test this file.
 *
 * This script is steps 2–4 of the `epic-lifecycle` loop (refresh → advance → collect) —
 * the parts that are pure procedure rather than judgment. Canonical rules live in
 * `docs/contributing/orchestration.md` (→ "Gates", "Spec review: the bar and the convergence
 * rule", "Settling a disputed claim"). **When a rule changes, change it there first.** The
 * comments here point at it rather than restating it.
 *
 * What it deliberately does NOT do — these stay with the coordinator (the session), because
 * a workflow script cannot do them at all: prompt the human (every gate), hold a PR
 * subscription or receive a webhook, schedule anything, or read/write `.orchestration/`.
 * State arrives via `args` and leaves via the return value.
 *
 * ## Two invariants, because the coordinator is this script's only memory
 *
 * **1. A null agent result means NOTHING HAPPENED.** `agent()` returns `null` when a sub-agent
 * dies or is skipped — infrastructure failure, not an outcome. Every `null` carries the prior
 * state forward and lets the next wake retry. Never synthesize a verdict from one: a fabricated
 * `INCONCLUSIVE` is exactly the "false evidence" orchestration.md forbids, and it consumes the
 * request that would have retried.
 *
 * **2. Never advance a cursor past work that didn't happen.** An activity cursor moves only
 * when the wake actually consumed that activity (a worker ran AND returned). Advancing it for a
 * row the cap deferred would erase the very feedback we just logged as "deferred to the next
 * wake" — silently dropping it instead.
 */

export const meta = {
  name: 'epic-wake',
  description:
    'One epic-lifecycle wake: check the epic gate, refresh every issue row, advance the ones with a pending action up to the cap, and settle looping factual claims.',
  whenToUse:
    'Dispatched by the epic-lifecycle skill as steps 2–4 of its loop, once per wake. Not run standalone — it expects the coordinator status table as args and returns the updated one.',
  phases: [
    { title: 'Refresh', detail: 'epic gate + Linear states + per-issue PR state (scout)' },
    { title: 'Advance', detail: 'one bounded issue-worker per pending issue, up to the cap' },
    { title: 'Settle', detail: 'dedupe disputed claims, run POCs, route verdicts' },
  ],
}

// ---------------------------------------------------------------------------
// Rules (pure — these are what the verify harness asserts)
// ---------------------------------------------------------------------------

/** Default review rounds per direction artifact (issue spec PR *and* the epic PR). */
const REVIEW_BUDGET = 2

/**
 * The only phases a row may hold. Shared by the scan schema and the worker schema deliberately:
 * `pendingAction` switches on this, so a value outside the set is a row that can never be acted
 * on again and carries nothing to explain why.
 */
const LIFECYCLE_PHASES = ['NEEDS_SPEC', 'AWAITING_SPEC_APPROVAL', 'NEEDS_IMPLEMENTATION', 'PR_FEEDBACK', 'DONE']

/**
 * Has a direction artifact's review run out of budget?
 * → orchestration.md § "The convergence rule" (canonical). One function for issue specs and
 * the epic PR alike, because they carry the same budget on the same terms.
 */
function atReviewBudget(spent = 0, aboveBarFound = false) {
  if (spent < REVIEW_BUDGET) return false
  // The conditional third round: authorized once, by round two's above-the-bar flag.
  if (aboveBarFound && spent === REVIEW_BUDGET) return false
  return true
}

/**
 * The next bounded action for one issue, or null if it is genuinely waiting on something
 * external. `why` is for the log line — a dispatch the user can't explain is drift.
 */
function pendingAction(row) {
  // An issue with an open blocked-by relation is not admitted to the active set; it's tracked
  // until its blocker merges. → epic-lifecycle § Intake, and § Boundaries (sequence, don't
  // run a dependent concurrently with its prerequisite).
  // Linear is authoritative on whether this issue still exists as work. A carried row whose
  // issue the human closed, canceled or dropped must stop dispatching — the terminal filter on
  // newly discovered children doesn't help a row that was already in the table.
  if (row.linearTerminal) return null

  if (row.blockedBy && row.blockedBy.length) return null

  // A worker that escalated a decision it could not make is WAITING ON A HUMAN. Re-dispatching
  // it on the next unrelated PR event or heartbeat would either retry the same dead end or push
  // the worker to invent the answer at the fork it was required to escalate. The coordinator
  // clears `blocker` when it records the human's resolution; until then this row is parked.
  if (row.blocker) return null

  // Verdicts are a LIST: two distinct claims on one issue can settle in the same wake, and a
  // single-slot field would drop one while consuming both settlement requests.
  if (row.verdicts && row.verdicts.length) {
    return { action: 'apply-verdict', why: `${row.verdicts.length} POC verdict(s) to fold` }
  }

  switch (row.phase) {
    case 'NEEDS_SPEC':
      return { action: 'spec', why: 'no spec yet' }

    case 'AWAITING_SPEC_APPROVAL':
      // A satisfied gate is a release, not a stop: approval chains straight through to
      // implementation in this same wake.
      //
      // An approving review can arrive in the SAME batch as fresh spec feedback. Approval still
      // wins — never hold an approved issue — but the feedback must not evaporate: the row is
      // about to become PR_FEEDBACK, whose machine never looks at `newSpecReviewEvents` again. So
      // the dispatch says so, and the worker carries the batch as implementer notes on its way
      // through (which is what the convergence rule does with remaining open threads anyway).
      if (row.specApproved) {
        return row.newSpecReviewEvents
          ? { action: 'implement', why: 'spec approved on current head, with outstanding spec-PR feedback to carry as implementer notes' }
          : { action: 'implement', why: 'spec approved on current head' }
      }
      if (row.newSpecReviewEvents) {
        if (atReviewBudget(row.specReviewRounds, row.specLevelFound)) return null // converged
        return { action: 'spec-review', why: `review round ${(row.specReviewRounds || 0) + 1}` }
      }
      return null

    case 'NEEDS_IMPLEMENTATION':
      return { action: 'implement', why: 'spec approved, implementation not started' }

    case 'PR_FEEDBACK':
      if (row.newPrEvents || row.ciFailed) return { action: 'pr-feedback', why: 'unhandled PR activity' }
      return null

    default:
      return null
  }
}

/**
 * One claim argued on two issues is ONE settlement fanned to both.
 * → orchestration.md § "Settling a disputed claim" ("Bound the fan-out"). Keyed on normalized
 * claim text, because independent workers phrase the same claim slightly differently.
 */
function dedupeClaims(requests) {
  const byClaim = new Map()
  for (const req of requests) {
    const key = (req.claim || '').trim().toLowerCase().replace(/\s+/g, ' ')
    if (!key) continue
    // A requeued claim already carries the fan-out it accumulated on an earlier wake. Seeding
    // from `issueId` alone would drop those targets, so the eventual verdict would reach only
    // one of the issues arguing it and the others' settlements would be consumed unfolded.
    const targets = req.issues && req.issues.length ? req.issues : req.issueId ? [req.issueId] : []
    const seen = byClaim.get(key)
    if (seen) {
      for (const id of targets) if (!seen.issues.includes(id)) seen.issues.push(id)
      // Merge the THREADS as well. Keeping only the first request's handle would fan the verdict
      // to every issue while leaving the other threads without their evidence-backed reply.
      const extra = (req.threads || '').trim()
      if (extra && !(seen.threads || '').includes(extra)) seen.threads = [seen.threads, extra].filter(Boolean).join(' · ')
    } else {
      byClaim.set(key, { ...req, issues: [...targets] })
    }
  }
  return [...byClaim.values()]
}

/**
 * Actions whose worker actually READS the PR review/CI events for its row. Only these consume
 * the activity cursor; `spec` has no events yet, and `implement` / `apply-verdict` are dispatched
 * on other grounds and never look at the review batch.
 */
const CONSUMES_REVIEW_ACTIVITY = new Set(['spec-review', 'pr-feedback'])

/**
 * Does a dispatch of `action` for `row` actually READ that row's review batch?
 *
 * One place, because two things depend on it agreeing: the cursor (advancing it for a batch nobody
 * read loses the feedback) and the worker prompt (telling a worker to carry feedback the cursor
 * won't consume replays it every wake).
 *
 * `implement` is the exception worth naming. It reads no review events in general — but when
 * approval and fresh spec feedback land in the same batch, approval wins and the row becomes
 * PR_FEEDBACK, whose machine never looks at `newSpecReviewEvents` again. That dispatch is therefore
 * the ONLY pass that can see the batch, so it is told to carry it as implementer notes and it
 * consumes it.
 */
function consumesReviewActivity(action, row) {
  if (CONSUMES_REVIEW_ACTIVITY.has(action)) return true
  return action === 'implement' && !!(row && row.newSpecReviewEvents)
}

/**
 * Fold one wake's outcome into one row — the single place a row's state advances.
 *
 * This is a named function rather than an inline map because it is where the field-by-field
 * update rules live, and scattering them produced repeated regressions: a field cleared when its
 * worker died, a flag reset by a worker that never reported it, a cursor advanced for work that
 * was deferred. Each rule below states what it protects against; change them here, together.
 *
 * @param row   the refreshed row (carried state + this wake's scout reads)
 * @param ctx   `worker` this wake's returned worker result (undefined if none ran or it died),
 *              `action` the action that was dispatched for this row, `landed` verdicts that
 *              settled this wake, `folded` whether a folder consumed them
 */
function nextRow(row, { worker, action, landed, folded }) {
  // Carried + newly settled, minus whatever a RETURNING folder consumed. A dead folder consumes
  // nothing, so its verdicts stay for the next wake.
  const verdicts = folded ? landed : [...(row.verdicts || []), ...landed]

  // A fold consumes CONFIRMED / REFUTED — the evidence resolves those claims. An INCONCLUSIVE
  // resolves nothing: orchestration.md hands the question back to the human. It still has to leave
  // `verdicts`, because `pendingAction` ranks a non-empty list above every phase, so a verdict no
  // fold can ever consume would re-dispatch a folder every wake forever. It converts instead to
  // `blocker` — the row's one durable human-decision field, which parks the row, surfaces in
  // `blockers`, survives every wake (a parked row dispatches no worker, and only a worker can
  // clear it), and is cleared by the coordinator when it records the decision.
  const unsettled = folded ? (row.verdicts || []).filter((v) => v.verdict === 'INCONCLUSIVE') : []
  const unsettledBlocker = unsettled.length
    ? `POC returned INCONCLUSIVE — needs a human decision: ${unsettled.map((v) => v.claim).join(' · ')}`
    : null

  // The cursor moves only when this wake consumed that activity — which takes BOTH a worker that
  // returned AND an action that actually reads review events. `apply-verdict` outranks
  // `spec-review` in `pendingAction`, and its prompt carries no review content, so counting it
  // as consumption would drop the concurrent feedback permanently. A deferred row keeps its
  // cursor for the same reason. (Invariant 2.)
  const hadNewActivity = !!(row.newSpecReviewEvents || row.newPrEvents)
  // A scan reporting new activity WITHOUT a timestamp gives the cursor nothing to move to, so the
  // consumed batch would be rediscovered every wake. That is the scan's failure, not the worker's:
  // the worker's reported state is still folded below, but the cursor stays put and the flags stay
  // live so the batch is genuinely re-derived rather than silently replayed.
  const cursorMovable = !(hadNewActivity && !row.latestActivityAt)
  // A worker that escalated a `blocker` did NOT finish reading that batch — same rule as the
  // verdict fold below. Consuming it would advance the cursor and clear the flags, so once the
  // human answers and the coordinator clears the blocker there is no pending event left to resume
  // from: the feedback, and the work waiting on that decision, are stranded.
  const workerFinished = !!worker && !worker.blocker
  const consumed = cursorMovable && ((workerFinished && consumesReviewActivity(action, row)) || !hadNewActivity)
  const cursor = consumed
    ? {
        lastSeenActivityAt: row.latestActivityAt || row.lastSeenActivityAt || null,
        lastSeenSha: row.headSha || row.lastSeenSha || null,
      }
    : { lastSeenActivityAt: row.lastSeenActivityAt || null, lastSeenSha: row.lastSeenSha || null }

  // Clear the transient flags this wake consumed. They are a SECOND representation of "there is
  // new activity" alongside the cursor, so leaving them set means a wake whose refresh scout dies
  // re-reads the carried `true` and re-dispatches an already-handled batch — spending a review
  // round twice, or applying the same fixes twice.
  const consumedFlags = consumed && hadNewActivity ? { newSpecReviewEvents: false, newPrEvents: false } : {}

  if (!worker) return { ...row, ...cursor, verdicts }

  // See `specReviewRounds` below: a review round that reports no count is charged one, because
  // charging zero makes the budget unreachable.
  const roundsSpent =
    action === 'spec-review' && worker.specReviewRoundsSpent === undefined ? 1 : worker.specReviewRoundsSpent || 0

  return {
    ...row,
    ...cursor,
    ...consumedFlags,
    phase: worker.phase || row.phase,
    specPr: worker.specPr === undefined ? row.specPr : worker.specPr,
    implPr: worker.implPr === undefined ? row.implPr : worker.implPr,
    // Same rule for a multi-PR issue's sub-PR table: only a worker that reported one replaces it.
    // These are the handles the coordinator subscribes to, so silently clearing them would make
    // every sub-PR's review, CI and merge event invisible for the rest of the epic.
    subPrs: worker.subPrs === undefined ? row.subPrs : worker.subPrs,
    // Same rule, and for the same reason: the assemble state machine resumes from these handles
    // across wakes, so clearing them restarts it — re-running the goal and filing a duplicate gap.
    assembledGoal: worker.assembledGoal === undefined ? row.assembledGoal : worker.assembledGoal,
    // Add only the rounds the worker reports SPENDING — never one per event dispatched.
    //
    // But a REVIEW worker that omits the count cannot be charged zero: the field is optional, so
    // every batch would consume its feedback, advance the cursor, and add nothing, and the budget
    // would never be reached — an unbounded review sequence, which is the exact failure the budget
    // exists to prevent. An unreported round is assumed spent. A worker that genuinely spent none
    // (a batch of pure factual corrections) says so explicitly with 0, which is honoured.
    specReviewRounds: (row.specReviewRounds || 0) + roundsSpent,
    // Whose answer this is depends on WHICH worker ran, because the canonical rule ties the
    // third round to what the LATEST round found: "spend a third round only when round two
    // surfaced a genuine spec-level finding" (orchestration.md § The convergence rule).
    //
    // A `spec-review` worker is that round, so its answer is authoritative in both directions —
    // an omission means "this round found nothing", and carrying round one's `true` through a
    // quiet round two would authorize a third round the rule doesn't.
    //
    // Any other worker (an apply-verdict fold, an implement run) isn't a review round at all and
    // the field is optional, so its silence must PRESERVE the flag — coercing that absence to
    // false revokes a third round a real review round had authorized.
    specLevelFound:
      action === 'spec-review'
        ? !!worker.specLevelFound
        : worker.specLevelFound === undefined
          ? !!row.specLevelFound
          : !!worker.specLevelFound,
    readyToMerge: !!worker.readyToMerge,
    blocker: worker.blocker || unsettledBlocker || null,
    status: worker.status,
    verdicts,
  }
}

/**
 * Split the wake's work across the cap.
 *
 * An epic-agent fold and a POC are each a full worktree, so all three draw from one cap.
 * Priority is deliberate: issue workers first (the actual work), then the epic fold (cheap,
 * and its result fans down), then settlements — anything over the cap queues to the next wake
 * rather than starving a worker.
 *
 * `epicApproved` gates **issue dispatch only.** The objective gate holds the sub-issues; it
 * does not hold the epic-spec's own review, which is explicitly budgeted during
 * AWAITING_OBJECTIVE (→ epic-lifecycle § "The epic's phases"). Folding epic-PR feedback is how
 * the objective gets revised into something approvable, so blocking it would deadlock the gate
 * it is waiting on.
 */
function allocate(rows, claims, cap, foldEpicWanted, epicApproved) {
  const actionable = []
  const converged = []
  const blocked = []
  const waiting = []

  for (const row of rows) {
    if (row.blockedBy && row.blockedBy.length) {
      blocked.push(row)
      continue
    }
    const next = pendingAction(row)
    if (next) actionable.push({ row, ...next })
    else if (row.phase === 'AWAITING_SPEC_APPROVAL' && row.newSpecReviewEvents) converged.push(row)
    else waiting.push(row)
  }

  const held = epicApproved ? [] : actionable
  const advance = epicApproved ? actionable.slice(0, cap) : []
  const deferred = epicApproved ? actionable.slice(cap) : []

  const foldEpic = foldEpicWanted && advance.length < cap
  const settle = claims.slice(0, Math.max(0, cap - advance.length - (foldEpic ? 1 : 0)))
  const queuedClaims = claims.slice(settle.length)

  return { advance, deferred, held, blocked, converged, waiting, foldEpic, settle, queuedClaims }
}

/**
 * Bind positional agent results to the rows that REQUESTED them.
 *
 * `issueId` is a free-form string in every scout and worker schema, so keying a Map on the
 * REPORTED value lets one agent's response land on a sibling row — including a `specApproved:
 * true` that belongs to a different issue, which bypasses the one gate that must never be
 * bypassable. `parallel()` preserves input order, so position is the only trustworthy key.
 *
 * A mismatch is DISCARDED, never reassigned: a result we cannot attribute is a result that didn't
 * happen, and both call sites already fail closed on an absent one (the refresh re-derives the
 * gates from scratch, and an absent worker reads as dead and mutates nothing but its cursor).
 *
 * @param results  agent results in dispatch order, `null` for any that died or was skipped
 * @param ids      the issue id each dispatch was FOR, in the same order
 * @param onMismatch called with (expectedId, reportedId) so the caller can log the discard
 */
/**
 * Does the coordinator's in-session approval still apply?
 *
 * `approvedInSession` carries the head SHA the human approved, so it is checked against the head
 * this wake observed rather than trusted outright: an approval that predates a push is the same
 * stale approval the scan rule refuses. A row with no observed head yet (no PR scanned) can't be
 * contradicted, so the recorded approval stands.
 *
 * @param row    the carried row (`approvedInSession` is the coordinator's record)
 * @param fresh  this wake's scan for that row, `{}` when the scout died
 */
/**
 * Fold a multi-PR row's live scan back into its durable handles.
 *
 * Three things only the scan knows, and each is a stall if it never lands:
 *
 * - a sub-PR the human merged (`issue-multi-pr` schedules the dependent rebase off `status`);
 * - the repair PR merging, which is the ONLY thing that re-arms the assembled goal — without it the
 *   DAG sits in `AWAITING_FIX` for good, because nothing else can set `fixMerged`;
 * - a resolved repair blocker. `fixBlocker` is duplicated by design (it is `issue-multi-pr`'s own
 *   durable field when that script runs standalone, with no epic row to mirror), so under an epic
 *   the row-level `blocker` is the single point of human resolution and the nested copy is DERIVED
 *   from it. Left to the coordinator to clear both, the nested one re-derives `REPAIR_BLOCKED`
 *   forever — a stall behind a field the documented resolution path never touches.
 *
 * @param row    the carried row
 * @param fresh  this wake's scan, `{}` when the scout died (in which case nothing is folded)
 */
function foldMultiPrScan(row, fresh) {
  const out = {}
  const states = (fresh && fresh.subPrStates) || []
  if (states.length && row.subPrs && row.subPrs.length) {
    const byId = new Map(states.map((s) => [s.id, s]))
    out.subPrs = row.subPrs.map((s) => {
      const live = byId.get(s.id)
      // Only ever ADVANCE a sub-PR to merged. A scan that omits an entry says nothing about it, and
      // demoting an open sub-PR to pending would have the next wake rebuild it from scratch.
      return live && live.merged && s.status !== 'merged' ? { ...s, status: 'merged' } : s
    })
  }
  if (row.assembledGoal) {
    const goal = { ...row.assembledGoal }
    let changed = false
    if (goal.fixPr && fresh && fresh.repairMerged && !goal.fixMerged) {
      goal.fixMerged = true
      changed = true
    }
    // The row-level blocker is authoritative: cleared there means the human answered.
    if (goal.fixBlocker && !row.blocker) {
      goal.fixBlocker = null
      changed = true
    }
    if (changed) out.assembledGoal = goal
  }
  return out
}

function approvedInSessionFor(row, fresh) {
  const at = row.approvedInSession
  if (!at) return false
  const head = (fresh && fresh.headSha) || null
  return !head || head === at
}

function bindByPosition(results, ids, onMismatch) {
  const byId = new Map()
  results.forEach((res, i) => {
    if (!res) return
    const id = ids[i]
    if (res.issueId && res.issueId !== id) {
      onMismatch(id, res.issueId)
      return
    }
    byId.set(id, res)
  })
  return byId
}

// ---------------------------------------------------------------------------
// Agent result schemas
// ---------------------------------------------------------------------------

/**
 * Render settled claims into a folding prompt. The verdict is a structured object, so it has to
 * be serialized field by field — string-interpolating it yields `[object Object]` and the
 * worker gets no claim, no evidence, and nothing to reply on the thread with.
 */
function renderVerdicts(verdicts) {
  return verdicts
    .map(
      (v, i) =>
        `  [${i + 1}] claim:    ${v.claim}\n      verdict:  ${v.verdict}\n      evidence: ${v.evidence || 'see the PR thread'}\n      threads:  ${v.threads || 'n/a'}`,
    )
    .join('\n')
}

/** The claim slice a requester owes → orchestration.md § "Settling a disputed claim". */
const SETTLE_REQUESTED_SCHEMA = {
  type: ['object', 'null'],
  additionalProperties: false,
  required: ['claim', 'load', 'falsify', 'threads'],
  properties: {
    claim: { type: 'string' },
    load: { type: 'string' },
    falsify: { type: 'string' },
    threads: { type: 'string' },
  },
}

const GATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  // Everything the wake branches on is required — see the gating-field invariant in verify.mjs.
  required: ['approved', 'newReviewEvents', 'headSha', 'latestActivityAt'],
  properties: {
    approved: { type: 'boolean', description: 'A human approving comment or a current-head APPROVED review by a non-author human' },
    approver: { type: ['string', 'null'] },
    headSha: { type: ['string', 'null'] },
    newReviewEvents: { type: 'boolean', description: 'Review activity STRICTLY NEWER than the activity cursor it was given' },
    latestActivityAt: { type: ['string', 'null'], description: 'ISO timestamp of the newest comment/review seen — the real cursor, since comments never move the head SHA' },
  },
}

const LINEAR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['issues'],
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'state'],
        properties: {
          id: { type: 'string' },
          state: { type: 'string' },
          blockedBy: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
}

const PR_STATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  // `specApproved` is REQUIRED: it gates the one mandatory human approval, so an omission
  // must never let a previously-true value survive a push onto an unapproved head.
  required: ['issueId', 'phase', 'specApproved', 'newSpecReviewEvents', 'newPrEvents', 'readyToMerge', 'ciFailed'],
  properties: {
    issueId: { type: 'string' },
    phase: { type: 'string', enum: LIFECYCLE_PHASES },
    specPr: { type: ['number', 'null'] },
    implPr: { type: ['number', 'null'] },
    specApproved: { type: 'boolean', description: 'Approving human comment/review on the CURRENT head — never a stale one' },
    newSpecReviewEvents: { type: 'boolean', description: 'Spec-PR review activity STRICTLY NEWER than the cursor it was given' },
    newPrEvents: { type: 'boolean', description: 'Impl-PR activity STRICTLY NEWER than the cursor it was given' },
    ciFailed: { type: 'boolean', description: 'Observed this scan — never inherited, so a recovered PR stops being re-dispatched' },
    merged: { type: 'boolean' },
    readyToMerge: { type: 'boolean' },
    // Per-handle state for a multi-PR row. One aggregate boolean is not actionable: a merge gate
    // needs the PR NUMBER of the slice that is green, and these rows have no single `implPr`.
    subPrStates: {
      type: 'array',
      description: 'One entry per sub-PR handle given in the prompt. Required for a multi-PR row; omit for single-PR issues.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'merged', 'readyToMerge'],
        properties: {
          id: { type: 'string' },
          merged: { type: 'boolean' },
          readyToMerge: { type: 'boolean' },
          ciFailed: { type: 'boolean' },
        },
      },
    },
    // The assembled-goal repair PR, which lives outside `subPrs` and whose merge is the only thing
    // that re-arms the end-to-end goal.
    repairMerged: { type: 'boolean' },
    repairReadyToMerge: { type: 'boolean' },
    // The advanced cursor, so the next wake can tell "already handled" from "new".
    latestActivityAt: {
      type: ['string', 'null'],
      description:
        'ISO timestamp of the newest comment/review seen. REQUIRED to be non-null whenever newSpecReviewEvents or newPrEvents is true — without it the cursor cannot advance past the batch a worker just consumed, and the same events are rediscovered every wake.',
    },
    headSha: { type: ['string', 'null'], description: 'Current head SHA of the open PR this row is waiting on' },
  },
}

const WORKER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  // A worker reports what it DID; the scan reports observed PR state. So `readyToMerge` is
  // required here (the worker knows whether it left the PR mergeable) while the scan-only flags
  // — specApproved, newSpecReviewEvents, newPrEvents — belong to PR_STATE_SCHEMA and are
  // deliberately NOT part of a worker's contract.
  required: ['issueId', 'phase', 'readyToMerge'],
  properties: {
    issueId: { type: 'string' },
    // The SAME enum the scan uses. A free-form string here is schema-valid, gets persisted by
    // `nextRow`, and then falls through `pendingAction`'s default on every subsequent wake — the
    // row parks forever with no gate and no blocker to explain it. A phase outside the lifecycle
    // is not a state the coordinator can act on, so it is rejected at the schema instead.
    phase: { type: 'string', enum: LIFECYCLE_PHASES },
    specPr: { type: ['number', 'null'] },
    implPr: { type: ['number', 'null'] },
    // A multi-PR issue's implementation is a DAG of sub-PRs, not one `implPr`. Without this the
    // worker has nowhere to return the table `issue-multi-pr` produced (`additionalProperties` is
    // false), so the coordinator can't persist or subscribe to the sub-PRs it just opened and every
    // later review, CI and merge event on them is invisible to the epic.
    subPrs: {
      type: 'array',
      description: 'For a multi-PR issue: the sub-PR table from issue-multi-pr, verbatim. Omit for single-PR issues.',
      items: {
        type: 'object',
        additionalProperties: true,
        required: ['id', 'status'],
        properties: {
          id: { type: 'string' },
          status: { type: 'string' },
          pr: { type: ['number', 'null'] },
          branch: { type: ['string', 'null'] },
          stackedOn: { type: ['string', 'null'] },
        },
      },
    },
    // The other half of a multi-PR issue's durable state. `subPrs` alone is not enough: the
    // assemble phase is a multi-wake state machine (goal → gap → fix → re-verify) that resumes from
    // these handles, so losing them re-runs the goal and files a duplicate gap issue every wake.
    assembledGoal: {
      type: 'object',
      additionalProperties: true,
      description: 'For a multi-PR issue: the assembledGoal state from issue-multi-pr, verbatim. Omit for single-PR issues.',
      properties: {
        passed: { type: 'boolean' },
        evidence: { type: ['string', 'null'] },
        failure: { type: ['string', 'null'] },
        owningSubPr: { type: ['string', 'null'] },
        fixIssue: { type: ['string', 'null'] },
        fixPr: { type: ['number', 'null'] },
        fixMerged: { type: 'boolean' },
        fixBlocker: { type: ['string', 'null'] },
      },
    },
    specReviewRoundsSpent: { type: 'number', description: 'Rounds ACTUALLY spent this dispatch — 0 for a batch that was only factual corrections' },
    specLevelFound: { type: 'boolean', description: 'Did this round surface a genuine spec-level finding? Authorizes the third round.' },
    settleRequested: SETTLE_REQUESTED_SCHEMA,
    blocker: { type: ['string', 'null'], description: 'Needs a human decision — the coordinator surfaces it' },
    readyToMerge: { type: 'boolean' },
    status: { type: 'string', description: 'One compact status line' },
  },
}

const EPIC_FOLD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['roundsSpent', 'aboveBar'],
  properties: {
    roundsSpent: { type: 'number', description: 'Rounds ACTUALLY spent — 0 for a batch that was only factual corrections' },
    aboveBar: { type: 'boolean', description: 'Did anything folded change the objective or a cross-cutting decision? Authorizes the third round.' },
    folded: { type: 'string', description: 'One compact line on what changed in the epic-spec' },
    // Note TEXT, not just target IDs: the coordinator deliberately never reads epic-PR content,
    // so an ID with no summary tells it where to route a note it cannot reproduce.
    fanOut: {
      type: 'array',
      description: 'Issue-local feedback routed OUT of the epic-spec, with the note to record',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['summary', 'issues'],
        properties: {
          summary: { type: 'string', description: 'The note to record, verbatim enough to act on' },
          issues: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    settleRequested: SETTLE_REQUESTED_SCHEMA,
  },
}

/** Where converged epic-PR feedback should go, when it is routed rather than folded. */
const EPIC_NOTES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['notes'],
  properties: {
    notes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['summary', 'fanOut'],
        properties: {
          summary: { type: 'string', description: 'One line — what the reviewer asked for' },
          fanOut: { type: 'array', items: { type: 'string' }, description: 'Sub-issue IDs it concerns; empty if none' },
        },
      },
    },
  },
}

const POC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  // `evidence` is required: a settled claim's whole value is the reproducible observation behind
  // it. Recording one without evidence closes a load-bearing question on nothing.
  required: ['claim', 'verdict', 'evidence'],
  properties: {
    claim: { type: 'string' },
    verdict: { type: 'string', enum: ['CONFIRMED', 'REFUTED', 'INCONCLUSIVE'] },
    evidence: { type: 'string' },
    prNumber: { type: ['number', 'null'], description: 'Set only when the POC found something worth a human PR' },
  },
}

// ---------------------------------------------------------------------------
// The wake
// ---------------------------------------------------------------------------

const epic = args.epic
const rows = args.issues || []
// An explicit positive cap wins; anything else (absent, 0, junk) falls back to the default
// rather than silently becoming it.
const cap = Number.isFinite(args.cap) && args.cap > 0 ? args.cap : 3
const requests = args.settleRequests || []

phase('Refresh')

// Barrier, and justified: the epic gate holds EVERY issue, and the cap is a decision
// across the whole set — nothing can be dispatched before all rows are known.
const [gate, linear, ...prStates] = await parallel([
  () =>
    agent(
      `Scan epic PR #${epic.prNumber} in this repo for its objective sign-off. Report approved:true ONLY for a human approving comment, or a review whose LATEST state is APPROVED on the CURRENT head by a human who is not the PR author. Exclude bots (Bugbot, Codex, Copilot) and any historical approval invalidated by a later push or CHANGES_REQUESTED.\n` +
        `ACTIVITY CURSOR: last seen activity at ${epic.lastSeenActivityAt || 'never'} (head ${epic.lastSeenSha || 'unknown'}). Set newReviewEvents ONLY for comments/reviews strictly newer than that TIMESTAMP — a comment never changes the head SHA, so the SHA alone cannot tell you what was already folded. Report latestActivityAt = the newest comment/review timestamp you saw.`,
      { label: 'gate:epic', phase: 'Refresh', schema: GATE_SCHEMA, agentType: 'scout' },
    ),
  () =>
    agent(
      `In ONE Linear query, fetch epic issue ${epic.issueId} and all of its sub-issues (parent→children). Return each sub-issue's id, current state name, and the ids of any open blocked-by relations. Do not fetch them individually.`,
      { label: 'linear:epic-children', phase: 'Refresh', schema: LINEAR_SCHEMA, agentType: 'scout' },
    ),
  ...rows.map(
    (row) => () =>
      agent(
        `Derive the current lifecycle phase of Linear issue ${row.id} from durable state only. Spec PR: ${row.specPr || 'none'}. Impl PR: ${row.implPr || 'none'}.\n` +
          // A multi-PR issue has NO single `implPr` — the real handles are the sub-PR table. Told
          // only "Impl PR: none", the scout has nothing to read, so a subscribed sub-PR event wakes
          // the coordinator and the row still reports no activity: stuck in PR_FEEDBACK for good.
          (row.subPrs && row.subPrs.length
            ? `This issue implements as a DAG of sub-PRs; there is no single impl PR. Treat these as its implementation PRs and report activity, CI and merge state across ALL of them: ${row.subPrs
                .map((s) => `${s.id}=${s.pr ? `#${s.pr}` : 'not opened'}${s.status ? ` (${s.status})` : ''}`)
                .join(', ')}.\n` +
              // An AGGREGATE readyToMerge cannot be acted on: a merge gate needs a PR NUMBER, and
              // `implPr` is unset for these rows. Per-handle readiness is what lets the coordinator
              // surface "merge sub-PR a (#41)" — without it the gate carries `pr: null` and the DAG
              // stops at its first merge-ready slice.
              `Report subPrStates: one entry per sub-PR id above — { id, merged, readyToMerge, ciFailed }. readyToMerge means THAT PR is approved, green and mergeable now.\n`
            : '') +
          // The repair PR is the other handle these rows wait on, and it is invisible in `subPrs`.
          // Its merge is what re-arms the assembled goal; unreported, the DAG sits in AWAITING_FIX
          // forever because nothing else can ever set `fixMerged`.
          (row.assembledGoal && row.assembledGoal.fixPr
            ? `This issue also has an assembled-goal REPAIR PR #${row.assembledGoal.fixPr} open (the end-to-end goal failed after its sub-PRs merged). Report repairMerged and repairReadyToMerge for it.\n`
            : '') +
          `Read the PRs' comments, reviews, check-runs and PR meta (state/mergedAt). specApproved is true ONLY for a human approving comment or a current-head APPROVED review by a non-author human — a stale approval invalidated by a later push is NOT approval, and no bot review counts.\n` +
          `ACTIVITY CURSOR — this is what separates new feedback from feedback already handled. Last seen: activity at ${row.lastSeenActivityAt || 'never'}, head ${row.lastSeenSha || 'unknown'}. Set newSpecReviewEvents / newPrEvents ONLY for activity strictly newer than that timestamp (or, if it is 'never', for any activity at all). Then report latestActivityAt = the newest comment/review timestamp you saw, and headSha = the current head, so the next wake can advance.\n` +
          `Also report whether CI is failing.`,
        { label: `refresh:${row.id}`, phase: 'Refresh', schema: PR_STATE_SCHEMA, agentType: 'scout' },
      ),
  ),
])

// The epic gate holds every sub-issue at NEEDS_SPEC until the objective is signed off — but it
// does NOT hold the epic-spec's own review (see allocate()). A dead gate scout is treated as
// "not approved": failing closed can only delay work, where failing open would ramp an epic
// nobody approved.
// A live scan is authoritative in both directions. Only when the scout DIED do we fall back to
// the durable approval the coordinator already recorded — re-locking an approved epic on an
// infrastructure failure would stall every sub-issue for a wake.
// An approval with no head cannot release work: `epicHead` would fall back to the carried,
// possibly pre-approval SHA, and workers are told to align to it without re-fetching.
const gateUsable = !!(gate && gate.headSha)
if (gate && gate.approved && !gate.headSha) {
  log('Epic gate reported approval without a current head — holding work this wake rather than aligning to a stale objective.')
}
const epicApproved = gateUsable ? !!gate.approved : !!epic.approved

// The head workers align to. It has to be THIS wake's observation: the wake that first sees
// approval is also the wake that releases the specs, and passing the carried SHA would align
// them to the objective as it stood before the fold that made it approvable.
const epicHead = (gate && gate.headSha) || epic.headSha || null

// Fold the scout reads into the carried table. Handles and counters come from `args`
// (the coordinator's file); phase and freshness come from the scouts.
const linearById = new Map((linear && linear.issues ? linear.issues : []).map((i) => [i.id, i]))
const freshById = bindByPosition(
  prStates,
  rows.map((r) => r.id),
  (id, reported) =>
    log(`refresh:${id} reported issueId ${reported} — discarding the scan rather than binding another issue's read (and its approval) to this row.`),
)

// Sub-issues Linear knows about that the carried table doesn't: `issue-manager` parented work
// discovered mid-epic under the epic, so the Linear scan is where it first appears. Building the
// table only from `rows` would discard it — the issue would be invisible to the coordinator and
// the epic could wrap without it (→ epic-lifecycle § Intake). They enter at NEEDS_SPEC and hit
// their own spec-approval gate like any other.
const TERMINAL_LINEAR = /^(done|closed|cancell?ed|duplicate|dropped|wo?n'?t ?do)$/i
const discovered = (linear && linear.issues ? linear.issues : [])
  .filter((li) => li.id && li.id !== epic.issueId && !rows.some((r) => r.id === li.id))
  // A child the human already closed or dropped is not new work. Entering it at NEEDS_SPEC would
  // dispatch a spec for a removed issue AND keep the epic from ever satisfying its wrap condition.
  .filter((li) => !TERMINAL_LINEAR.test((li.state || '').trim()))
  .map((li) => ({ id: li.id, phase: 'NEEDS_SPEC', specReviewRounds: 0, specLevelFound: false, discovered: true }))

if (discovered.length) {
  log(`Discovered ${discovered.length} new sub-issue(s) under the epic: ${discovered.map((d) => d.id).join(', ')} — entering at NEEDS_SPEC.`)
}

const refreshed = [...rows, ...discovered].map((row) => {
  const fresh = freshById.get(row.id) || {}
  const refreshedLive = freshById.has(row.id)
  const li = linearById.get(row.id) || {}
  return {
    ...row,
    ...fresh,
    id: row.id,
    // Two channels satisfy this gate, and they need opposite handling.
    //
    // A SCAN-derived approval is never carried: spreading `fresh` over the row would let a stale
    // `specApproved: true` survive a scan that omitted it, implementing on a head the human never
    // approved — the one gate that must not be bypassable.
    //
    // An IN-SESSION approval ("the user saying 'approved' in-session", epic-lifecycle § Gates &
    // autonomy) is a first-class channel with no PR artifact for a scout to find, so discarding it
    // would leave that documented path unable to ever release the issue. The coordinator records it
    // as `approvedInSession: <the head it was given for>`, and it counts only while that head is
    // still current — a push after the human spoke is exactly the staleness the scan rule guards.
    specApproved: (refreshedLive ? !!fresh.specApproved : false) || approvedInSessionFor(row, fresh),
    // Same rule: a push or a new review invalidates merge-readiness, so a live scan is the only
    // source. A stale `true` would surface a merge gate for a PR that is no longer mergeable.
    readyToMerge: refreshedLive ? !!fresh.readyToMerge : false,
    // Same rule: CI that recovered must stop looking like a failure, or pr-feedback re-dispatches forever.
    ciFailed: refreshedLive ? !!fresh.ciFailed : false,
    // Same rule again for the per-handle readiness a multi-PR row's merge gates are built from.
    // These are observations, never durable state: a carried `readyToMerge` would keep surfacing a
    // merge gate for a sub-PR the human already merged, or for one a later push made unmergeable.
    // (The merged flags are folded into the durable `subPrs` / `assembledGoal` by foldMultiPrScan.)
    subPrStates: refreshedLive ? fresh.subPrStates || [] : [],
    repairReadyToMerge: refreshedLive ? !!fresh.repairReadyToMerge : false,
    linearState: li.state || row.linearState,
    linearTerminal: linearById.has(row.id) ? TERMINAL_LINEAR.test((li.state || '').trim()) : !!row.linearTerminal,
    // Distinguish "the refresh didn't see this row" from "the refresh saw it and it has no
    // blockers". A present row is authoritative and CLEARS a resolved blocker (its absent
    // `blockedBy` is schema-valid and means none); an absent row means the scout died or
    // skipped it, so the carried relation stands. Getting this backwards either un-blocks an
    // issue on a failed refresh or blocks it forever after its prerequisite merged.
    blockedBy: linearById.has(row.id) ? li.blockedBy || [] : row.blockedBy || [],
    // Counters are the coordinator's, never the scout's — they survive across wakes.
    specReviewRounds: row.specReviewRounds || 0,
    specLevelFound: !!row.specLevelFound,
    // A multi-PR row's live handles: merged sub-PRs, a merged repair, a resolved repair blocker.
    ...foldMultiPrScan(row, fresh),
  }
})

const claims = dedupeClaims(requests)
if (claims.length < requests.length) {
  log(`Deduped ${requests.length} settlement request(s) into ${claims.length} claim(s).`)
}

// The epic PR is a direction artifact on the same budget as an issue spec — the one surface
// where an unbounded review loop would otherwise sit directly on the top-level gate.
const newEpicReviewEvents = !!(gate && gate.newReviewEvents)
const epicAtBudget = atReviewBudget(epic.reviewRounds, epic.aboveBarFound)
// A POC verdict on a cross-cutting claim is folded regardless of the budget — new evidence is
// not another opinion (orchestration.md § "What it costs").
const epicVerdictsToFold = epic.verdicts && epic.verdicts.length ? epic.verdicts : null
// The verdict's budget exemption covers the VERDICT ONLY. When a carried verdict and ordinary
// converged review feedback coexist, folding both would let the evidence exemption smuggle in a
// full extra review round — so the two paths run side by side: the fold takes the verdict, and
// the converged feedback still goes out through the notes route.
const foldEpicWanted = !!epicVerdictsToFold || (newEpicReviewEvents && !epicAtBudget)
// At budget the epic-spec stops being FOLDED — but the feedback still has to be ROUTED, or
// convergence silently drops it. The gate scout returns only a boolean and a timestamp, so
// nothing here knows what the comments said or which issues they touch: that needs its own
// cheap read. Without it this branch logged "routed as implementer notes" while routing nothing.
const routeConvergedEpicFeedback = newEpicReviewEvents && epicAtBudget
if (routeConvergedEpicFeedback) {
  log(
    `Epic-spec converged (${epic.reviewRounds || 0} rounds spent) — not folding review feedback; reading it to route as implementer notes` +
      `${epicVerdictsToFold ? ', while the POC verdict folds separately (evidence is exempt from the budget, ordinary feedback is not)' : ''}.`,
  )
}

const plan = allocate(refreshed, claims, cap, foldEpicWanted, epicApproved)

// No silent caps — say what was held back and why.
if (!epicApproved) {
  log(
    `Epic objective not signed off — holding ${plan.held.length} issue(s) at NEEDS_SPEC` +
      `${plan.foldEpic ? ', but still folding epic-PR review so the objective can be revised' : ''}.`,
  )
}
for (const row of plan.blocked) {
  log(`${row.id}: blocked by ${row.blockedBy.join(', ')} — tracked, not admitted to the active set.`)
}
for (const row of plan.converged) {
  log(`${row.id}: spec converged (${row.specReviewRounds} rounds spent) — review event logged, awaiting the human gate.`)
}
if (plan.deferred.length) {
  log(`Cap ${cap} reached — deferring ${plan.deferred.map((d) => d.row.id).join(', ')} to the next wake.`)
}
if (foldEpicWanted && !plan.foldEpic) {
  log(`Cap ${cap} reached — epic-spec fold queued behind the issue workers.`)
}
if (plan.queuedClaims.length) {
  log(`Cap ${cap} reached — ${plan.queuedClaims.length} settlement(s) queued behind the issue workers.`)
}
for (const item of plan.advance) {
  if (item.action === 'spec-review' && (item.row.specReviewRounds || 0) >= REVIEW_BUDGET) {
    log(`${item.row.id}: spending the authorized third review round — round two surfaced a spec-level finding.`)
  }
}

phase('Advance')

const [advanced, epicFold, epicNotes] = await Promise.all([
  parallel(
    plan.advance.map((item) => () =>
      agent(
        `Advance ${item.row.id} to its next external wait, in your own worktree. Reason it is pending: ${item.why}.\n` +
          `Epic: ${epic.issueId} on branch ${epic.branch} (head ${epicHead || 'fetch it'}) — align to the epic-spec without re-fetching the epic.\n` +
          `A satisfied gate is NOT a wait — chain through it: a just-approved spec goes close-spec-PR → implement → open the impl PR in this one run.\n` +
          (item.action === 'apply-verdict'
            ? `POC settlement(s) landed on this issue. Apply them per issue-spec 6.5.3 BEFORE anything else — fold each verdict, post the evidence-backed reply on its thread, and record the claim as resolved-with-evidence in the spec's §12:\n${renderVerdicts(item.row.verdicts)}\n`
            : '') +
          (item.action === 'implement' && item.row.newSpecReviewEvents
            ? `The approving batch on spec PR ${item.row.specPr || '(the spec PR)'} ALSO carries outstanding review feedback. Read it and carry it as implementer notes BEFORE you close the spec PR — do not spend a review round on it and do not fold it into the spec. This is the only pass that sees it: nothing looks at spec-PR review activity once this row reaches PR_FEEDBACK.\n`
            : '') +
          (item.row.subPrs && item.row.subPrs.length
            ? `This issue implements as a DAG of sub-PRs. Its plan and handles: ${JSON.stringify(item.row.subPrs)}. Advance it with the issue-multi-pr workflow and return the updated subPrs table AND assembledGoal state.\n`
            : '') +
          `Do not prompt the user. Return the compact status object and exit.`,
        {
          label: `${item.action}:${item.row.id}`,
          phase: 'Advance',
          schema: WORKER_SCHEMA,
          agentType: 'issue-worker',
          isolation: 'worktree',
        },
      ),
    ),
  ),
  plan.foldEpic
    ? agent(
        (epicVerdictsToFold
          ? `A POC settled ${epicVerdictsToFold.length} cross-cutting claim(s) for this epic. Fold them FIRST and record each in the epic-spec's cross-cutting decisions so a sibling issue can't reopen it:\n${renderVerdicts(epicVerdictsToFold)}\n` +
            `Post the evidence-backed reply on the thread. This fold is outside the review budget — new evidence is not another opinion.\n\n`
          : '') +
        (epicAtBudget || !newEpicReviewEvents
          ? `Fold the verdict above and NOTHING ELSE — there is no new review feedback to fold${epicAtBudget ? ' and the review budget is spent' : ''}, so do not re-read or re-fold already-consumed comments, and report roundsSpent: 0. The evidence exemption covers the verdict only.\n`
          : `Fold the outstanding review feedback on epic PR #${epic.prNumber} into the epic-spec on branch ${epic.branch}, in your worktree.\n` +
            `Triage against the bar first: only objective-level or cross-cutting-decision-level feedback is folded. Anything about a single issue's internals is routed to that issue as an implementer note, never into the epic-spec — return each as a fanOut entry with the note text and the issues it concerns.\n`) +
          `Refresh the epic-spec's running index from the PR handles already recorded. Never re-review to satisfy a bot.\n` +
          `Report the rounds you ACTUALLY spent — a batch of only factual corrections or broken references costs zero — and whether anything folded was above the bar.\n` +
          `Do not prompt the user.`,
        { label: 'fold:epic', phase: 'Advance', schema: EPIC_FOLD_SCHEMA, agentType: 'epic-agent', isolation: 'worktree' },
      )
    : Promise.resolve(null),
  // Converged: read the feedback cheaply (scout, no worktree) purely to get its fan-out targets
  // so the coordinator can route it as implementer notes. No fold, no round spent.
  routeConvergedEpicFeedback
    ? agent(
        `Epic PR #${epic.prNumber} has review activity newer than ${epic.lastSeenActivityAt || 'never'}. The epic-spec has CONVERGED, so nothing is being folded — read the outstanding comments and reviews and report only where each should go.\n` +
          `For each item, name the sub-issue(s) it actually concerns (its fanOut) and give a one-line summary. Items that concern no specific issue get an empty fanOut. Do not edit anything; do not reply on the PR.`,
        { label: 'route:epic-notes', phase: 'Advance', schema: EPIC_NOTES_SCHEMA, agentType: 'scout' },
      )
    : Promise.resolve(null),
])

phase('Settle')

const settled = await parallel(
  plan.settle.map((claim) => () =>
    agent(
      `Settle ONE disputed claim with a throwaway POC in your worktree, rebased on fresh origin/main.\n` +
        `claim:   ${claim.claim}\nload:    ${claim.load}\nfalsify: ${claim.falsify}\nthreads: ${claim.threads}\n` +
        `Design the runnable check yourself; run it on the real path. Return CONFIRMED / REFUTED / INCONCLUSIVE with evidence. Open a PR only if you found something worth a human's eyes.`,
      { label: `poc:${(claim.claim || '').slice(0, 40)}`, phase: 'Settle', schema: POC_SCHEMA, agentType: 'poc-agent', isolation: 'worktree' },
      // The REQUESTED claim wins over the reported one. `claim` is a free-form string in POC_SCHEMA,
      // so a POC that paraphrases it — or echoes a sibling's — would replace the canonical text
      // while its request is consumed: the verdict then fans to the requesting issues and is folded
      // onto their threads under a claim nobody argued. Same rule as the row-id binding above:
      // identity comes from the dispatch, not from the response.
    ).then((poc) => (poc ? { ...claim, ...poc, claim: claim.claim, issues: claim.issues } : null)),
  ),
)

// A dead POC agent is not an INCONCLUSIVE verdict. Requeue the claim so the next wake retries
// it, and reserve INCONCLUSIVE for a real poc-agent answer — fabricating one would close a
// load-bearing question on evidence that never existed.
const unsettled = plan.settle.filter((_, i) => !settled[i])
if (unsettled.length) {
  log(`${unsettled.length} POC(s) returned nothing (agent died or skipped) — requeued, NOT recorded as INCONCLUSIVE.`)
}

// A verdict has to land ON the issue rows, not just in the return payload: the settled request
// is consumed this wake, so a verdict the coordinator can't see on a row would be lost — the
// claim would never get folded. `pendingAction` picks `row.verdict` up as 'apply-verdict' on
// the next wake, which is the path that fold travels. Carry the WHOLE settlement, not just the
// enum: the folding worker needs the claim, the evidence and the threads to post the
// evidence-backed reply and to know what a REFUTED verdict should change.
const verdictsByIssue = new Map()
for (const s of settled.filter(Boolean)) {
  const record = { claim: s.claim, verdict: s.verdict, evidence: s.evidence || null, threads: s.threads || null, prNumber: s.prNumber || null }
  for (const id of s.issues || []) {
    // Append, never overwrite: two POCs completing in one wake both consumed their requests,
    // so a replaced verdict is a claim that can never be folded.
    verdictsByIssue.set(id, [...(verdictsByIssue.get(id) || []), record])
  }
}

// ---------------------------------------------------------------------------
// The updated table — the coordinator writes this to `.orchestration/`, surfaces the
// gates, sets the Linear mirrors, and owns the subscriptions.
// ---------------------------------------------------------------------------

const workerById = bindByPosition(
  advanced,
  plan.advance.map((i) => i.row.id),
  (id, reported) => log(`worker for ${id} reported issueId ${reported} — discarding the result; ${id} counts as un-advanced this wake.`),
)

// Settlement requests raised during THIS wake — by an issue worker or by the epic fold.
// Read through the POSITION-BOUND map, not the raw results: a request attributed by the worker's
// self-reported id would fan a settlement — and its verdict — to an issue that never argued it.
const newRequests = [
  ...[...workerById].filter(([, w]) => w.settleRequested).map(([id, w]) => ({ ...w.settleRequested, issueId: id })),
  ...(epicFold && epicFold.settleRequested ? [{ ...epicFold.settleRequested, issueId: epic.issueId }] : []),
]

// A verdict is consumed only when its folding worker actually RETURNED. Deriving this from the
// planned dispatch would clear the row's only copy even when the worker died — losing the POC
// result permanently, since its settlement request was consumed too.
// A worker that returned a `blocker` escalated instead of finishing, so it did NOT fold. Counting
// it as a fold deletes the row's only copy of the claim, evidence and owed thread reply, and then
// parks the row — so once the human answers the blocker there is nothing left to apply. Returning
// is necessary but not sufficient; completing without escalating is the condition.
const foldedVerdict = new Set(
  plan.advance
    .filter((i) => i.action === 'apply-verdict')
    .filter((i) => {
      const w = workerById.get(i.row.id)
      if (!w) return false
      if (w.blocker) {
        log(`${i.row.id}: the verdict fold escalated a decision (${w.blocker}) — keeping the verdict to apply once it's answered.`)
        return false
      }
      return true
    })
    .map((i) => i.row.id),
)

const actionByIssue = new Map(plan.advance.map((i) => [i.row.id, i.action]))

// The epic's INCONCLUSIVE claims, carried the way a row's `blocker` is.
//
// Keeping an INCONCLUSIVE in `epic.verdicts` (the previous behaviour) made `foldEpicWanted` true
// on every subsequent wake for a verdict no fold can consume — an epic-agent worktree spent every
// wake, forever. Dropping it instead would lose a decision the human owes. So it leaves the
// dispatch-driving field and becomes durable state that is re-surfaced in `blockers` each wake
// until the coordinator records the decision and removes it: surfaced once and forgotten loses it
// just as thoroughly as clearing it did.
const epicUnsettled = [...(epic.unsettled || [])]
for (const v of epicFold ? (epicVerdictsToFold || []).filter((v) => v.verdict === 'INCONCLUSIVE') : []) {
  if (!epicUnsettled.some((u) => u.claim === v.claim)) {
    epicUnsettled.push({ claim: v.claim, evidence: v.evidence || null, threads: v.threads || null })
  }
}

const issues = refreshed.map((row) =>
  nextRow(row, {
    worker: workerById.get(row.id),
    action: actionByIssue.get(row.id),
    landed: verdictsByIssue.get(row.id) || [],
    folded: foldedVerdict.has(row.id),
  }),
)

// Disclosure must cover EVERY unresolved claim touching an issue, not just the ones this wake
// happened to dispatch: a claim the cap queued, one a worker raised this wake, and one whose POC
// died are all still contested. Telling the user "nothing in flight" while a load-bearing premise
// is unsettled is the exact failure the disclosure rule exists to prevent.
const pendingClaims = [...plan.settle, ...plan.queuedClaims, ...unsettled, ...newRequests]
const contestedClaimFor = (issueId) => {
  const hit = pendingClaims.find((c) => (c.issues || [c.issueId]).includes(issueId))
  if (hit) return hit.claim
  // A verdict that LANDED but hasn't been folded yet (cap-deferred, or its folder died) is still
  // in flight for disclosure purposes: the coordinator must not close the spec PR while a REFUTED
  // fold still needs that live artifact and thread.
  const row = issues.find((r) => r.id === issueId)
  const unfolded = row && row.verdicts && row.verdicts.length ? row.verdicts[0] : null
  return unfolded ? `${unfolded.claim} (verdict ${unfolded.verdict}, not yet folded)` : null
}

const gates = [
  // The objective gate comes first: until it's signed off, it's the only one that can move.
  ...(epicApproved ? [] : [{ kind: 'epic-objective', pr: epic.prNumber }]),
  // Child gates only while the objective stands. Surfacing them alongside a closed epic gate isn't
  // just noise: a human would be approving specs aligned to an objective the epic is in the middle
  // of revising, and once the objective is re-approved those stale child approvals release
  // implementation with no second alignment gate. `allocate()` already holds the issues, so a gate
  // the coordinator cannot act on is a trap, not information.
  // Same terminal exclusion as the merge gate below: a child the human closed or dropped whose
  // spec PR is still open must not keep asking them to approve a spec for removed work.
  // `pendingAction` already parks the row, but this filter is independent of it.
  ...(!epicApproved ? [] : issues.filter((r) => r.phase === 'AWAITING_SPEC_APPROVAL' && !r.specApproved && !r.linearTerminal).map((r) => ({
    kind: 'spec-approval',
    issueId: r.id,
    pr: r.specPr,
    settlingInFlight: contestedClaimFor(r.id),
  }))),
  // A child the human closed or dropped must not keep asking them to merge it.
  // A merge gate is only actionable with a PR NUMBER, so it is emitted per HANDLE, not per row.
  // A multi-PR row has no `implPr` at all — one aggregate gate for it carried `pr: null`, which the
  // coordinator cannot surface, so the DAG stopped at its first merge-ready slice.
  ...issues
    .filter((r) => !r.linearTerminal)
    .flatMap((r) => {
      const gates = []
      // Single-PR: the row's own impl PR.
      if (r.readyToMerge && r.implPr) gates.push({ kind: 'merge', issueId: r.id, pr: r.implPr })
      // Multi-PR: each sub-PR the scan reported green, named so the human knows which slice.
      for (const s of r.subPrs || []) {
        const live = (r.subPrStates || []).find((x) => x.id === s.id)
        if (live && live.readyToMerge && !live.merged && s.pr) {
          gates.push({ kind: 'merge', issueId: r.id, pr: s.pr, subPr: s.id })
        }
      }
      // And the assembled-goal repair PR, which is neither of those.
      if (r.assembledGoal && r.assembledGoal.fixPr && !r.assembledGoal.fixMerged && r.repairReadyToMerge) {
        gates.push({ kind: 'merge', issueId: r.id, pr: r.assembledGoal.fixPr, repair: true })
      }
      return gates
    }),
]

return {
  epicApproved,
  epic: {
    ...epic,
    // Advance the cursor only if the fold actually returned (or there was nothing new) — same
    // consumed-not-observed rule as the issue rows. The TIMESTAMP is the real cursor; the SHA
    // is carried alongside it but a comment never moves it.
    // The FUNCTIONAL head handle, always refreshed from the live scan. Issue workers align to
    // `epic.headSha` and are told not to re-fetch it, so a stale one aligns their specs and
    // implementations to a superseded objective. This is not the review cursor.
    headSha: epicHead,
    // A previously recorded approval is DURABLE (the coordinator mirrors it to a label), so a
    // dead scout must not re-lock an epic that was already signed off — that would stall every
    // sub-issue on an infrastructure failure. A live scan still revokes it (a push after
    // approval re-opens the gate), which is the case failing closed actually protects.
    approved: gate ? !!gate.approved : !!epic.approved,
    // Requested note routing that DIDN'T return leaves the ordinary feedback unrouted, so the
    // cursor must not move — otherwise it is consumed permanently. (Invariant 2.)
    ...((routeConvergedEpicFeedback ? !!epicNotes : !!epicFold) || !newEpicReviewEvents
      ? {
          lastSeenActivityAt: (gate && gate.latestActivityAt) || epic.lastSeenActivityAt || null,
          lastSeenSha: (gate && gate.headSha) || epic.lastSeenSha || null,
        }
      : { lastSeenActivityAt: epic.lastSeenActivityAt || null, lastSeenSha: epic.lastSeenSha || null }),
    // Same rule as an issue's: add only the rounds the folder reports spending.
    reviewRounds: (epic.reviewRounds || 0) + (epicFold ? epicFold.roundsSpent || 0 : 0),
    // Same rule as a row's `specLevelFound`, keyed on the same question: was this dispatch a
    // review round? `aboveBar` is REQUIRED, so a verdict-only fold has to report something — and
    // it reports `false`, which would revoke a third round an earlier real round authorized. So
    // the fold's answer is authoritative only when it actually spent a round; a zero-round fold
    // (evidence exemption, or a batch of pure factual corrections) preserves the flag.
    aboveBarFound: epicFold && (epicFold.roundsSpent || 0) > 0 ? !!epicFold.aboveBar : !!epic.aboveBarFound,
    converged: epicAtBudget,
    // An epic-level verdict clears only once a fold returned to record it; otherwise it is
    // carried so the next wake retries. A settlement targeting the epic has no issue row to
    // land on, so this field is its only destination.
    // An INCONCLUSIVE verdict settles nothing, but it does not belong here either — see
    // `epicUnsettled`, which is where it goes so it neither re-triggers a fold nor disappears.
    verdicts: epicFold
      ? [...(verdictsByIssue.get(epic.issueId) || [])]
      : [...(epicVerdictsToFold || []), ...(verdictsByIssue.get(epic.issueId) || [])],
    // Decisions the human owes on this epic. Durable across wakes; the coordinator drops an entry
    // when it records the resolution, exactly as it clears a row's `blocker`.
    unsettled: epicUnsettled,
  },
  epicFold: epicFold ? { folded: epicFold.folded, fanOut: epicFold.fanOut || [] } : null,
  // Converged epic-PR feedback, read but not folded — the coordinator routes each note to the
  // issues it names as an implementer note. Empty/absent when nothing needed routing.
  epicNotes: epicNotes ? epicNotes.notes || [] : null,
  issues,
  gates,
  blockers: [
    ...issues.filter((r) => r.blocker).map((r) => ({ issueId: r.id, blocker: r.blocker })),
    ...epicUnsettled.map((u) => ({ issueId: epic.issueId, blocker: `POC returned INCONCLUSIVE — needs a human decision: ${u.claim}` })),
  ],
  blocked: plan.blocked.map((r) => ({ issueId: r.id, blockedBy: r.blockedBy })),
  held: plan.held.map((i) => i.row.id),
  verdicts: settled.filter(Boolean),
  settleRequests: [
    ...plan.queuedClaims,
    // Claims whose POC agent never returned: requeued, not silently dropped.
    ...unsettled,
    ...newRequests,
  ],
  dispatched: [...plan.advance.map((i) => `${i.action}:${i.row.id}`), ...(plan.foldEpic ? ['fold:epic'] : [])],
  deferred: plan.deferred.map((i) => i.row.id),
  converged: plan.converged.map((r) => r.id),
}
