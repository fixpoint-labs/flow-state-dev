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
  if (row.blockedBy && row.blockedBy.length) return null

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
 * One claim argued on two issues is ONE settlement fanned to both.
 * → orchestration.md § "Settling a disputed claim" ("Bound the fan-out"). Keyed on normalized
 * claim text, because independent workers phrase the same claim slightly differently.
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

// ---------------------------------------------------------------------------
// Agent result schemas
// ---------------------------------------------------------------------------

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
    settleRequested: SETTLE_REQUESTED_SCHEMA,
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
    settleRequested: SETTLE_REQUESTED_SCHEMA,
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

// The epic gate holds every sub-issue at NEEDS_SPEC until the objective is signed off — but it
// does NOT hold the epic-spec's own review (see allocate()). A dead gate scout is treated as
// "not approved": failing closed can only delay work, where failing open would ramp an epic
// nobody approved.
const epicApproved = !!(gate && gate.approved)

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

// The epic PR is a direction artifact on the same budget as an issue spec — the one surface
// where an unbounded review loop would otherwise sit directly on the top-level gate.
const newEpicReviewEvents = !!(gate && gate.newReviewEvents)
const epicAtBudget = atReviewBudget(epic.reviewRounds, epic.aboveBarFound)
const foldEpicWanted = newEpicReviewEvents && !epicAtBudget
if (newEpicReviewEvents && epicAtBudget) {
  log(`Epic-spec converged (${epic.reviewRounds || 0} rounds spent) — epic-PR feedback logged and routed as implementer notes, not folded.`)
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

const settled = await parallel(
  plan.settle.map((claim) => () =>
    agent(
      `Settle ONE disputed claim with a throwaway POC in your worktree, rebased on fresh origin/main.\n` +
        `claim:   ${claim.claim}\nload:    ${claim.load}\nfalsify: ${claim.falsify}\nthreads: ${claim.threads}\n` +
        `Design the runnable check yourself; run it on the real path. Return CONFIRMED / REFUTED / INCONCLUSIVE with evidence. Open a PR only if you found something worth a human's eyes.`,
      { label: `poc:${(claim.claim || '').slice(0, 40)}`, phase: 'Settle', schema: POC_SCHEMA, agentType: 'poc-agent', isolation: 'worktree' },
    ).then((poc) => ({ claim: claim.claim, issues: claim.issues, ...(poc || { verdict: 'INCONCLUSIVE' }) })),
  ),
)

// A verdict has to land ON the issue rows, not just in the return payload: the settled request
// is consumed this wake, so a verdict the coordinator can't see on a row would be lost — the
// claim would never get folded. `pendingAction` picks `row.verdict` up as 'apply-verdict' on
// the next wake, which is the path that fold travels.
const verdictByIssue = new Map()
for (const s of settled.filter(Boolean)) {
  for (const id of s.issues || []) verdictByIssue.set(id, s.verdict)
}

// ---------------------------------------------------------------------------
// The updated table — the coordinator writes this to `.orchestration/`, surfaces the
// gates, sets the Linear mirrors, and owns the subscriptions.
// ---------------------------------------------------------------------------

const workerById = new Map(advanced.filter(Boolean).map((w) => [w.issueId, w]))

const appliedVerdict = new Set(plan.advance.filter((i) => i.action === 'apply-verdict').map((i) => i.row.id))

const issues = refreshed.map((row) => {
  // A verdict this wake just applied is consumed; a verdict that just landed is carried.
  const verdict = appliedVerdict.has(row.id) ? null : verdictByIssue.get(row.id) || row.verdict || null
  const w = workerById.get(row.id)
  if (!w) return { ...row, verdict }
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
    verdict,
  }
})

const gates = [
  // The objective gate comes first: until it's signed off, it's the only one that can move.
  ...(epicApproved ? [] : [{ kind: 'epic-objective', pr: epic.prNumber }]),
  ...issues.filter((r) => r.phase === 'AWAITING_SPEC_APPROVAL' && !r.specApproved).map((r) => ({
    kind: 'spec-approval',
    issueId: r.id,
    pr: r.specPr,
    settlingInFlight: (plan.settle.find((c) => c.issues.includes(r.id)) || {}).claim || null,
  })),
  ...issues.filter((r) => r.readyToMerge).map((r) => ({ kind: 'merge', issueId: r.id, pr: r.implPr })),
]

return {
  epicApproved,
  epic: {
    ...epic,
    // Advance the review cursor to the head we just scanned, or the same epic-PR event keeps
    // re-triggering a fold every wake — a zero-round fold would repeat forever.
    lastSeenSha: (gate && gate.headSha) || epic.lastSeenSha || null,
    // Same rule as an issue's: add only the rounds the folder reports spending.
    reviewRounds: (epic.reviewRounds || 0) + (epicFold ? epicFold.roundsSpent || 0 : 0),
    aboveBarFound: epicFold ? !!epicFold.aboveBar : !!epic.aboveBarFound,
    converged: epicAtBudget,
  },
  epicFold: epicFold ? { folded: epicFold.folded, fanOut: epicFold.fanOut || [] } : null,
  issues,
  gates,
  blockers: issues.filter((r) => r.blocker).map((r) => ({ issueId: r.id, blocker: r.blocker })),
  blocked: plan.blocked.map((r) => ({ issueId: r.id, blockedBy: r.blockedBy })),
  held: plan.held.map((i) => i.row.id),
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
