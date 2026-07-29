/**
 * epic-wake — one wake of the epic-lifecycle coordinator, as deterministic control flow.
 *
 * This script is steps 2–4 of the `epic-lifecycle` loop (refresh → advance → collect).
 * It exists because those steps are pure procedure: an epic gate that holds every issue,
 * a two-round spec-review budget with one conditional third round, a concurrency cap
 * shared between issue workers and POC settlements, and a claim dedupe. Encoded as prose
 * the coordinator had to re-derive all of that every wake; encoded here it is `if`
 * statements that cannot drift.
 *
 * What it deliberately does NOT do — these stay with the coordinator (the session), because
 * a workflow script cannot do them at all:
 *   - prompt the human (every gate: spec approval, epic objective, merge)
 *   - hold a PR subscription or receive a webhook
 *   - schedule a check-in, or wait for anything external
 *   - read or write `.orchestration/` (no filesystem in a script) — state arrives via
 *     `args` and leaves via the return value; the coordinator owns the file
 *
 * Canonical rules this encodes live in `docs/contributing/orchestration.md`
 * (→ "Gates", "Spec review: the bar and the convergence rule", "Settling a disputed claim").
 * When a rule changes, it changes there first, then here.
 *
 * Verified by `.agents/workflows/verify.mjs` (stubbed hooks, no agents spawned).
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
 * Has a direction artifact's review run out of budget?
 *
 * Two rules, both from orchestration.md → "The convergence rule", and both easy to get
 * wrong in prose: the count is rounds the worker *reported spending* (a batch of pure
 * factual corrections costs zero), and a third round is authorized when — and only when —
 * round two reported something above the bar.
 *
 * One function, because the epic PR carries the same budget on the same terms — three
 * separate prose restatements of this is what it replaces.
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
  if (row.verdict) return { action: 'apply-verdict', why: `POC verdict ${row.verdict} to fold` }

  switch (row.phase) {
    case 'NEEDS_SPEC':
      return { action: 'spec', why: 'no spec yet' }

    case 'AWAITING_SPEC_APPROVAL':
      // A satisfied gate is a release, not a stop: approval chains straight through to
      // implementation in this same wake.
      if (row.specApproved) return { action: 'implement', why: 'spec approved on current head' }
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
 * One claim argued on two issues is ONE settlement fanned to both. Keyed on the normalized
 * claim text, because the same claim reaches us from independent workers that phrased it
 * slightly differently.
 */
function dedupeClaims(requests) {
  const byClaim = new Map()
  for (const req of requests) {
    const key = (req.claim || '').trim().toLowerCase().replace(/\s+/g, ' ')
    if (!key) continue
    const seen = byClaim.get(key)
    if (seen) {
      if (!seen.issues.includes(req.issueId)) seen.issues.push(req.issueId)
    } else {
      byClaim.set(key, { ...req, issues: [req.issueId] })
    }
  }
  return [...byClaim.values()]
}

/**
 * Split the wake's work across the cap.
 *
 * An epic-agent fold and a POC are each a full worktree, so they draw from the same cap as
 * the issue workers. Priority is deliberate: issue workers first (they are the actual work),
 * then the epic fold (cheap, and its result fans down), then settlements. Anything over the
 * cap queues to the next wake rather than starving a worker.
 */
function allocate(rows, claims, cap, foldEpicWanted) {
  const actionable = []
  const converged = []
  const waiting = []

  for (const row of rows) {
    const next = pendingAction(row)
    if (next) actionable.push({ row, ...next })
    else if (row.phase === 'AWAITING_SPEC_APPROVAL' && row.newSpecReviewEvents) converged.push(row)
    else waiting.push(row)
  }

  const advance = actionable.slice(0, cap)
  const deferred = actionable.slice(cap)

  const foldEpic = foldEpicWanted && advance.length < cap
  const settle = claims.slice(0, Math.max(0, cap - advance.length - (foldEpic ? 1 : 0)))
  const queuedClaims = claims.slice(settle.length)

  return { advance, deferred, converged, waiting, foldEpic, settle, queuedClaims }
}

// ---------------------------------------------------------------------------
// Agent result schemas
// ---------------------------------------------------------------------------

const GATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['approved'],
  properties: {
    approved: { type: 'boolean', description: 'A human approving comment or a current-head APPROVED review by a non-author human' },
    approver: { type: ['string', 'null'] },
    headSha: { type: ['string', 'null'] },
    newReviewEvents: { type: 'boolean', description: 'Unhandled review activity since the last wake' },
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
  required: ['issueId', 'phase'],
  properties: {
    issueId: { type: 'string' },
    phase: {
      type: 'string',
      enum: ['NEEDS_SPEC', 'AWAITING_SPEC_APPROVAL', 'NEEDS_IMPLEMENTATION', 'PR_FEEDBACK', 'DONE'],
    },
    specPr: { type: ['number', 'null'] },
    implPr: { type: ['number', 'null'] },
    specApproved: { type: 'boolean', description: 'Approving human comment/review on the CURRENT head — never a stale one' },
    newSpecReviewEvents: { type: 'boolean' },
    newPrEvents: { type: 'boolean' },
    ciFailed: { type: 'boolean' },
    merged: { type: 'boolean' },
    readyToMerge: { type: 'boolean' },
  },
}

const WORKER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['issueId', 'phase'],
  properties: {
    issueId: { type: 'string' },
    phase: { type: 'string' },
    specPr: { type: ['number', 'null'] },
    implPr: { type: ['number', 'null'] },
    specReviewRoundsSpent: { type: 'number', description: 'Rounds ACTUALLY spent this dispatch — 0 for a batch that was only factual corrections' },
    specLevelFound: { type: 'boolean', description: 'Did this round surface a genuine spec-level finding? Authorizes the third round.' },
    settleRequested: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['claim', 'load', 'falsify', 'threads'],
      properties: {
        claim: { type: 'string' },
        load: { type: 'string' },
        falsify: { type: 'string' },
        threads: { type: 'string' },
      },
    },
    blocker: { type: ['string', 'null'], description: 'Needs a human decision — the coordinator surfaces it' },
    readyToMerge: { type: 'boolean' },
    status: { type: 'string', description: 'One compact status line' },
  },
}

const EPIC_FOLD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['roundsSpent'],
  properties: {
    roundsSpent: { type: 'number', description: 'Rounds ACTUALLY spent — 0 for a batch that was only factual corrections' },
    aboveBar: { type: 'boolean', description: 'Did anything folded change the objective or a cross-cutting decision? Authorizes the third round.' },
    folded: { type: 'string', description: 'One compact line on what changed in the epic-spec' },
    fanOut: { type: 'array', items: { type: 'string' }, description: 'Issue IDs an above-the-bar item touches — the coordinator routes these' },
    settleRequested: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['claim', 'load', 'falsify', 'threads'],
      properties: {
        claim: { type: 'string' },
        load: { type: 'string' },
        falsify: { type: 'string' },
        threads: { type: 'string' },
      },
    },
  },
}

const POC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['claim', 'verdict'],
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
const cap = args.cap || 3
const requests = args.settleRequests || []

phase('Refresh')

// Barrier, and justified: the epic gate holds EVERY issue, and the cap is a decision
// across the whole set — nothing can be dispatched before all rows are known.
const [gate, linear, ...prStates] = await parallel([
  () =>
    agent(
      `Scan epic PR #${epic.prNumber} in this repo for its objective sign-off. Report approved:true ONLY for a human approving comment, or a review whose LATEST state is APPROVED on the CURRENT head by a human who is not the PR author. Exclude bots (Bugbot, Codex, Copilot) and any historical approval invalidated by a later push or CHANGES_REQUESTED. Also report whether there is unhandled review activity since head SHA ${epic.lastSeenSha || 'unknown'}.`,
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
        `Derive the current lifecycle phase of Linear issue ${row.id} from durable state only. Spec PR: ${row.specPr || 'none'}. Impl PR: ${row.implPr || 'none'}. Read the PRs' comments, reviews, check-runs and PR meta (state/mergedAt). specApproved is true ONLY for a human approving comment or a current-head APPROVED review by a non-author human — a stale approval invalidated by a later push is NOT approval, and no bot review counts. Report unhandled activity since the last wake and whether CI is failing.`,
        { label: `refresh:${row.id}`, phase: 'Refresh', schema: PR_STATE_SCHEMA, agentType: 'scout' },
      ),
  ),
])

// The epic gate: no objective sign-off means every sub-issue holds at NEEDS_SPEC. Return
// before dispatching anything — this is the one place the whole set is blocked at once.
if (!gate || !gate.approved) {
  log(`Epic gate not met — holding all ${rows.length} issue(s) at NEEDS_SPEC.`)
  return {
    epicApproved: false,
    epicReviewEvents: gate ? gate.newReviewEvents : false,
    gates: [{ kind: 'epic-objective', pr: epic.prNumber }],
    issues: rows,
    settleRequests: requests,
    dispatched: [],
  }
}

// Fold the scout reads into the carried table. Handles and counters come from `args`
// (the coordinator's file); phase and freshness come from the scouts.
const linearById = new Map((linear && linear.issues ? linear.issues : []).map((i) => [i.id, i]))
const freshById = new Map(prStates.filter(Boolean).map((s) => [s.issueId, s]))

const refreshed = rows.map((row) => {
  const fresh = freshById.get(row.id) || {}
  const li = linearById.get(row.id) || {}
  return {
    ...row,
    ...fresh,
    id: row.id,
    linearState: li.state || row.linearState,
    blockedBy: li.blockedBy || [],
    // Counters are the coordinator's, never the scout's — they survive across wakes.
    specReviewRounds: row.specReviewRounds || 0,
    specLevelFound: !!row.specLevelFound,
  }
})

const claims = dedupeClaims(requests)
if (claims.length < requests.length) {
  log(`Deduped ${requests.length} settlement request(s) into ${claims.length} claim(s).`)
}

// The epic PR is a direction artifact on the same budget as an issue spec — the epic-spec
// stops being folded when it converges, which is the one surface where an unbounded review
// loop would otherwise sit directly on the top-level gate.
const epicAtBudget = atReviewBudget(epic.reviewRounds, epic.aboveBarFound)
const foldEpicWanted = !!gate.newReviewEvents && !epicAtBudget
if (gate.newReviewEvents && epicAtBudget) {
  log(`Epic-spec converged (${epic.reviewRounds || 0} rounds spent) — epic-PR feedback logged and routed as implementer notes, not folded.`)
}

const plan = allocate(refreshed, claims, cap, foldEpicWanted)

// No silent caps — say what was held back and why.
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

const [advanced, epicFold] = await Promise.all([
  parallel(
    plan.advance.map((item) => () =>
      agent(
        `Advance ${item.row.id} to its next external wait, in your own worktree. Reason it is pending: ${item.why}.\n` +
          `Epic: ${epic.issueId} on branch ${epic.branch} (head ${epic.headSha || 'fetch it'}) — align to the epic-spec without re-fetching the epic.\n` +
          `A satisfied gate is NOT a wait — chain through it: a just-approved spec goes close-spec-PR → implement → open the impl PR in this one run.\n` +
          (item.action === 'apply-verdict'
            ? `A POC verdict landed: ${item.row.verdict}. Apply it per issue-spec 6.5.3 before anything else.\n`
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
        `Fold the outstanding review feedback on epic PR #${epic.prNumber} into the epic-spec on branch ${epic.branch}, in your worktree.\n` +
          `Triage against the bar first: only objective-level or cross-cutting-decision-level feedback is folded. Anything about a single issue's internals is routed to that issue as an implementer note, never into the epic-spec — return those issue IDs as fanOut.\n` +
          `Refresh the epic-spec's running index from the PR handles already recorded. Never re-review to satisfy a bot.\n` +
          `Report the rounds you ACTUALLY spent — a batch of only factual corrections or broken references costs zero — and whether anything folded was above the bar.\n` +
          `Do not prompt the user.`,
        { label: 'fold:epic', phase: 'Advance', schema: EPIC_FOLD_SCHEMA, agentType: 'epic-agent', isolation: 'worktree' },
      )
    : Promise.resolve(null),
])

phase('Settle')

// A genuine two-stage pipeline: each POC's verdict routes to its issues the moment that
// POC finishes, without waiting on the other settlements or on the issue workers.
const settled = await pipeline(
  plan.settle,
  (claim) =>
    agent(
      `Settle ONE disputed claim with a throwaway POC in your worktree, rebased on fresh origin/main.\n` +
        `claim:   ${claim.claim}\nload:    ${claim.load}\nfalsify: ${claim.falsify}\nthreads: ${claim.threads}\n` +
        `Design the runnable check yourself; run it on the real path. Return CONFIRMED / REFUTED / INCONCLUSIVE with evidence. Open a PR only if you found something worth a human's eyes.`,
      { label: `poc:${(claim.claim || '').slice(0, 40)}`, phase: 'Settle', schema: POC_SCHEMA, agentType: 'poc-agent', isolation: 'worktree' },
    ),
  (poc, claim) => ({ claim: claim.claim, issues: claim.issues, ...(poc || { verdict: 'INCONCLUSIVE' }) }),
)

// ---------------------------------------------------------------------------
// The updated table — the coordinator writes this to `.orchestration/`, surfaces the
// gates, sets the Linear mirrors, and owns the subscriptions.
// ---------------------------------------------------------------------------

const workerById = new Map(advanced.filter(Boolean).map((w) => [w.issueId, w]))

const issues = refreshed.map((row) => {
  const w = workerById.get(row.id)
  if (!w) return row
  return {
    ...row,
    phase: w.phase,
    specPr: w.specPr === undefined ? row.specPr : w.specPr,
    implPr: w.implPr === undefined ? row.implPr : w.implPr,
    // Add only the rounds the worker reports SPENDING — never one per event dispatched.
    specReviewRounds: (row.specReviewRounds || 0) + (w.specReviewRoundsSpent || 0),
    specLevelFound: !!w.specLevelFound,
    readyToMerge: !!w.readyToMerge,
    blocker: w.blocker || null,
    status: w.status,
    verdict: null, // consumed by this wake's apply-verdict dispatch
  }
})

const gates = [
  ...issues.filter((r) => r.phase === 'AWAITING_SPEC_APPROVAL' && !r.specApproved).map((r) => ({
    kind: 'spec-approval',
    issueId: r.id,
    pr: r.specPr,
    settlingInFlight: (plan.settle.find((c) => c.issues.includes(r.id)) || {}).claim || null,
  })),
  ...issues.filter((r) => r.readyToMerge).map((r) => ({ kind: 'merge', issueId: r.id, pr: r.implPr })),
]

return {
  epicApproved: true,
  epic: {
    ...epic,
    // Same rule as an issue's: add only the rounds the folder reports spending.
    reviewRounds: (epic.reviewRounds || 0) + (epicFold ? epicFold.roundsSpent || 0 : 0),
    aboveBarFound: epicFold ? !!epicFold.aboveBar : !!epic.aboveBarFound,
    converged: epicAtBudget,
  },
  epicFold: epicFold ? { folded: epicFold.folded, fanOut: epicFold.fanOut || [] } : null,
  issues,
  gates,
  blockers: issues.filter((r) => r.blocker).map((r) => ({ issueId: r.id, blocker: r.blocker })),
  verdicts: settled.filter(Boolean),
  settleRequests: [
    ...plan.queuedClaims,
    ...advanced.filter(Boolean).filter((w) => w.settleRequested).map((w) => ({ ...w.settleRequested, issueId: w.issueId })),
    ...(epicFold && epicFold.settleRequested ? [{ ...epicFold.settleRequested, issueId: epic.issueId }] : []),
  ],
  dispatched: [...plan.advance.map((i) => `${i.action}:${i.row.id}`), ...(plan.foldEpic ? ['fold:epic'] : [])],
  deferred: plan.deferred.map((i) => i.row.id),
  converged: plan.converged.map((r) => r.id),
}
