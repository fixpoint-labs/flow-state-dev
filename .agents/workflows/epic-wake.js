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
  // ...but a CARRIED VERDICT outranks completion. A POC is non-blocking by design, so it can land after
  // the implementation PR merged and Linear moved to Done — and parking first meant that verdict was
  // never applied: not recorded in the spec, no evidence-backed reply on its thread, and the epic wrapped
  // as though the question had never been asked. `orchestration.md` treats dropping evidence as a
  // correctness failure, not an efficiency one.
  //
  // A CANCELLED issue is different: the work is gone, so there is nothing to fold a verdict into. It is
  // dropped, but out loud (below), never silently.
  if (row.linearTerminal) {
    const finished = !CANCELLED_LINEAR.test((row.linearState || '').trim())
    if (finished && row.verdicts && row.verdicts.length) {
      return { action: 'apply-verdict', why: `${row.verdicts.length} POC verdict(s) landed after the issue completed` }
    }
    // ...and an ANSWERED DECISION outranks completion for the same reason a verdict does. An INCONCLUSIVE
    // late verdict is folded into a human blocker and LEAVES `verdicts`, so by the time the human answers
    // there is no verdict here to match — this return then parked the row and the epic wrapped without the
    // answer ever reaching the completed spec or its thread. The decision was made; dropping it is the
    // same correctness failure as dropping the evidence that prompted it.
    if (finished && (row.blockerResolutions || []).length) {
      return { action: 'apply-decision', why: `${row.blockerResolutions.length} answered decision(s) landed after the issue completed` }
    }
    return null
  }

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

  const phaseAction = (() => {
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
        // The row-side twin of the epic's guard: activity with no timestamp cannot advance a cursor,
        // so folding it spends a round on a batch the next wake rediscovers — repeatedly, until the
        // budget converges on one batch. Withhold the work instead of consuming the budget with it.
        if (!cursorUsable(row)) return null
        if (atReviewBudget(row.specReviewRounds, row.specLevelFound)) return null // converged
        return { action: 'spec-review', why: `review round ${(row.specReviewRounds || 0) + 1}` }
      }
      return null

    case 'NEEDS_IMPLEMENTATION':
      // The phase NAME asserts approval; only `specApproved` establishes it, and the schema validates
      // the two independently — so a scout that derives the phase wrongly would dispatch
      // implementation on a spec no human ever approved. This is the one gate that must never be
      // bypassable, so the phase is not allowed to be the thing that carries it.
      if (!row.specApproved) return null
      return { action: 'implement', why: 'spec approved, implementation not started' }

    case 'PR_FEEDBACK':
      // Same guard: a CI failure needs no timestamp (it is not comment activity), but reported PR
      // activity without one would be re-applied every wake.
      // CI is actionable on its own — but NOT while the same scan reports review activity it cannot
      // timestamp. `pr-feedback` consumes the review cursor, and an unreadable cursor cannot advance, so
      // the dispatch would re-deliver that identical batch every wake and the worker would re-post its
      // replies each time. The cost is a CI fix waiting a wake for a scan that timestamps its activity;
      // the alternative is unbounded duplicate replies on someone's PR, which is not recoverable by
      // waiting. A CI failure with no unreadable activity is untouched.
      if (row.ciFailed && !(row.newPrEvents && !cursorUsable(row))) return { action: 'pr-feedback', why: 'CI is failing' }
      if (row.newPrEvents && cursorUsable(row)) return { action: 'pr-feedback', why: 'unhandled PR activity' }
      // A multi-PR row's DAG advances on merges and on its own deferred work, neither of which is
      // "PR activity". Without this the issue stalls the moment a merge unblocks its next slice.
      if (multiPrHasWork(row)) return { action: 'implement', why: 'multi-PR DAG has work: a ready slice, a deferred one, or the assembled goal' }
      return null

    default:
      return null
    }
  })()
  if (phaseAction) return phaseAction

  // FALLBACK, reached only when the phase itself has nothing to do. An answered decision is work for a
  // SINGLE-PR row too: this check lived only inside `multiPrHasWork`, so a single-PR row — an
  // INCONCLUSIVE POC verdict becomes a row blocker, which the human then answers — had its blocker
  // cleared and its answer queued with no action able to apply it, while the spec-approval or merge gate
  // could reappear for the unchanged artifact.
  //
  // A fallback rather than a precedence, so a row with real phase work still does that work — the prompt
  // hands every dispatched worker the answers verbatim, so nothing is lost by letting the phase win.
  // Scoped to rows with no sub-PRs: a multi-PR row's answer travels through `issue-multi-pr`, which the
  // `implement` path above already reaches.
  if (!(row.subPrs || []).length && (row.blockerResolutions || []).length) {
    return { action: 'apply-decision', why: `${row.blockerResolutions.length} answered decision(s) to apply` }
  }
  return null
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
      // And the FRAMING, for the same reason threads are merged. Two issues can argue the same claim in
      // the same words while meaning it about different load-bearing paths, so keeping only the first
      // request's `load`/`falsify` would have the POC exercise one path and the verdict fan to both — a
      // verdict presented as evidence for something it never ran. Merging keeps the dedupe (one
      // settlement, which is the point) while making its evidence cover every issue it answers.
      for (const field of ['load', 'falsify']) {
        const more = (req[field] || '').trim()
        if (more && !(seen[field] || '').includes(more)) seen[field] = [seen[field], more].filter(Boolean).join(' · ')
      }
    } else {
      byClaim.set(key, { ...req, issues: [...targets] })
    }
  }
  return [...byClaim.values()]
}

/**
 * Read a counter that has TWO documented spellings.
 *
 * The prose named these `spec_review_rounds` and `epic_review_rounds` long before this script existed
 * (`issue-lifecycle` § the budget, `orchestration.md` § the epic fold, `epic-agent`'s own contract), and
 * the script introduced camelCase without translating. An epic resumed from a cache written under the
 * old names therefore reads its spent budget as zero and grants a fresh two rounds — silently
 * restarting the convergence budget, which is the unbounded-review failure the budget exists to
 * prevent. Dual-read rather than rename: the snake_case names are the established convention in the
 * documents a human writes, and BP-030 asks the reader to tolerate the shape already persisted.
 *
 * @param row    the carried record
 * @param camel  the name this script uses
 * @param snake  the name the prose documents
 */
function carriedCount(row, camel, snake) {
  const v = row[camel] === undefined ? row[snake] : row[camel]
  return Number.isFinite(v) ? v : 0
}

/**
 * The same dual-read for a carried BOOLEAN (BP-030).
 *
 * `spec_review_rounds` was dual-read while `spec_level_found` — the flag that AUTHORIZES the
 * conditional third round, and which the previous lifecycle instructions documented by that name —
 * was not. An epic resumed from those instructions therefore read the count as 2 and the
 * authorization as false, declared convergence, and silently skipped a round the rules allow.
 */
function carriedFlag(row, camel, snake) {
  return !!(row[camel] === undefined ? row[snake] : row[camel])
}

/**
 * A sub-PR row's dependency edges, under either documented spelling.
 *
 * `issue-spec`'s PR-plan table and `issue-lifecycle`'s cache row both say `depends_on`; `classify()`
 * and `readySet()` read `dependsOn` and nothing converted between them. A coordinator following its
 * own documented cache format hands over rows whose dependencies read as EMPTY — which
 * `readySet` treats as "everything merged", so a dependent is built straight onto `origin/main`
 * concurrently with the prerequisite it declared. The DAG violated by a spelling.
 */
function dependsOnOf(node) {
  const edges = node.dependsOn === undefined ? node.depends_on : node.dependsOn
  return Array.isArray(edges) ? edges : []
}

/**
 * The human decisions this row is carrying, as a LIST.
 *
 * A single slot loses answers, and the sibling-blocker queue guarantees it will. Two slices escalate
 * in one wake; the row surfaces A, the human answers it, and the refresh clears A's nested blocker and
 * lifts B in the same pass — which parks the row, so A's answer is never dispatched. The human then
 * answers B, the coordinator writes into the one field, and A's decision is gone: its slice resumes
 * with nothing and re-escalates the identical fork. Exactly the reasoning `verdicts` already carries
 * ("two distinct claims on one issue can settle in the same wake, and a single-slot field would drop
 * one") — the lesson was in this file and I added the field without applying it.
 *
 * @returns `[{ for, answer }]`, each aimed at the slice that asked (null = the row itself)
 */
function normalizeResolutions(row) {
  const raw = []
  for (const r of row.blockerResolutions || []) if (r && r.answer) raw.push({ for: r.for || null, answer: r.answer })
  // BP-030: tolerate the single-slot shape a coordinator may already have persisted mid-epic.
  if (row.blockerResolution) raw.push({ for: row.blockerResolutionFor || null, answer: row.blockerResolution })
  const seen = new Set()
  const out = []
  for (const r of raw) {
    // An untargeted answer belongs to the slice the row most recently surfaced. Read from the CARRIED
    // row, before the fold lifts the next sibling over `blockerFor` — after that, the aim is lost.
    const target = r.for || row.blockerFor || null
    const key = `${target || "-"} :: ${r.answer}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ for: target, answer: r.answer })
  }
  return out
}

/**
 * Is this row waiting on a human decision?
 *
 * One predicate, because every consumer has to agree. `pendingAction` parks on it, and each GATE has
 * to withhold on it too — a merge gate did (after review found it) and the spec-approval gate did not,
 * so the coordinator invited a human to approve a spec whose open architectural question was still
 * unanswered, and approval releases implementation. Approving an artifact we know is unfinished is the
 * gate granting itself.
 *
 * `blockedBy` is deliberately NOT part of this. An open prerequisite is a sequencing constraint that
 * does not change what the spec says, so approving early is harmless and saves a later wait; it still
 * withholds the MERGE gate, where landing order is the whole point.
 */
function awaitingHumanDecision(row) {
  return !!row.blocker
}

/**
 * Bind a scan's per-handle sub-PR states to the handles that were REQUESTED.
 *
 * One function, because two callers have to agree about it: `cursorUsable` decides whether the scan
 * may consume the row's activity, and `foldMultiPrScan` decides what it persists. Positional binding
 * behind a set-coverage guard let exactly those two disagree — a scan reporting every requested
 * handle in a DIFFERENT ORDER passed coverage, then had every entry discarded by the positional bind.
 * A merge was announced, never persisted, and the feedback worker ate the activity that announced it,
 * so the dependent slice (or the assembled goal) parked with no further event coming. A scout that
 * consistently orders that way parks it permanently.
 *
 * Two different questions hide behind that, and they need different answers:
 *
 * - **Is it ATTRIBUTABLE?** Every entry labelled, no handle reported twice, no id outside the
 *   requested set. Then the id is the trustworthy key, and using it does not weaken "identity comes
 *   from the dispatch": the set of handles a response can touch is exactly the set that was
 *   dispatched, so no reported id introduces a handle or moves a result onto another one. Position was
 *   only ever a proxy for that, and a worse one — it discarded correct data on a reorder.
 * - **Is it COMPLETE?** Every requested handle actually answered.
 *
 * A partial-but-attributable scan is safely FOLDED (a merge only ever advances, and folding it lets
 * the DAG move a wake earlier) while still being unfit to CONSUME the row's activity — the unanswered
 * handle may be the one that merged. Requiring completeness for both would throw away good
 * observations; requiring it for neither loses merges. So the caller picks which question it is asking.
 *
 * @returns `{ byId, complete }`, or null when nothing in the scan can be attributed at all
 */
function subPrScanBinding(subPrs, states) {
  if (!subPrs || !subPrs.length) return null
  const reported = states || []
  const wanted = new Set(subPrs.map((sp) => sp.id))
  const byId = new Map()
  for (const st of reported) {
    if (!st || !st.id || byId.has(st.id) || !wanted.has(st.id)) return null
    byId.set(st.id, st)
  }
  return { byId, complete: subPrs.every((sp) => byId.has(sp.id)) }
}

/**
 * Can this row's cursor move past the activity it is reporting?
 *
 * A scan may report new activity and omit `latestActivityAt` — schema-valid, and useless: there is
 * nothing to advance the cursor to. Dispatching anyway consumes the batch (a review round spent, or
 * PR fixes applied) while the cursor stays put, so the next wake rediscovers exactly the same
 * feedback and does it again. Withholding is the recoverable outcome: the flag stays live and the
 * batch is genuinely re-derived once a scan reports a timestamp.
 *
 * The same rule covers every OTHER observation the prompt asked this scan for and it left out. An
 * incomplete scan that consumes the batch destroys the announcement of whatever it failed to look at,
 * and the row then waits on an event that already happened. Requiring these of every scan would
 * burden single-PR rows with meaningless fields; each clause fails closed only where it applies.
 */
function cursorUsable(row) {
  const hasActivity = !!(row.newSpecReviewEvents || row.newPrEvents)
  if (hasActivity && !row.latestActivityAt) return false
  // Per-handle sub-PR state. Here the question is COMPLETENESS: an unanswered handle may be the one
  // that merged, so consuming the activity that announced it destroys the announcement.
  if (row.subPrs && row.subPrs.length) {
    const binding = subPrScanBinding(row.subPrs, row.subPrStates)
    if (!binding || !binding.complete) return false
  }
  // The assembled-goal repair PR's merge. `repairMerged` is the ONLY observation that sets
  // `fixMerged`, and while that stays false the assemble machine waits in AWAITING_FIX — so a scan
  // that omits the field after the repair landed loses the merge, and the row waits for a merge event
  // that will never come again. `repairScanned` records that the scan answered at all, so `false` is
  // an answer and an omission is not.
  const goal = row.assembledGoal || {}
  if (goal.fixPr && !goal.fixMerged && !row.repairScanned) return false
  return true
}

/**
 * A multi-PR row's phase is DERIVED, never taken from the scout.
 *
 * Two failures, in opposite directions, come from letting a scout name it. `DONE` is schema-valid,
 * and a scout looking at a row whose last sub-PR just merged will reasonably say it — which finishes
 * the issue without ever running the assembled end-to-end goal that the merges do *not* satisfy.
 * And `PR_FEEDBACK` with no newer comment dispatches nothing, so the DAG stalls exactly when a merge
 * has unblocked its next slice.
 *
 * So: never DONE until the goal has actually passed, and otherwise PR_FEEDBACK, where the
 * multi-PR clause in `pendingAction` decides whether there is work.
 *
 * @returns the derived phase, or null when this is not a multi-PR row
 */
/**
 * A phase that ASSERTS approval is corrected to what the row can actually prove.
 *
 * `NEEDS_IMPLEMENTATION` means "the spec was approved and implementation hasn't started", but only
 * `specApproved` establishes that and the schema validates the two independently — so a scout that
 * derives the phase wrongly would implement a spec no human approved, the one gate that must never be
 * bypassable. Refusing to DISPATCH is not enough on its own: the row then sits at a phase whose gate
 * filter doesn't match, so nothing is surfaced either — a silent stall in place of the bypass. So the
 * phase is corrected: with a spec PR it is awaiting approval (and gets that gate), without one there
 * is no spec to approve and it needs authoring.
 */
function approvalGatedPhase(row) {
  if (row.phase !== 'NEEDS_IMPLEMENTATION' || row.specApproved) return null
  return row.specPr ? 'AWAITING_SPEC_APPROVAL' : 'NEEDS_SPEC'
}

/**
 * A single-PR row's completion is DERIVED FROM THE MERGE, in both directions.
 *
 * Both schemas let an agent report `phase` and `merged` independently, so both mismatches are
 * schema-valid and each strands the row in the opposite direction:
 *
 * - `DONE` with no merge — a worker that has just opened an implementation PR will reasonably feel
 *   done. `pendingAction` never revisits the row, so the coordinator mirrors Done in Linear and can
 *   wrap the epic before the human merges anything: the merge gate bypassed by a self-report.
 * - `PR_FEEDBACK` with `merged: true` — the honest report of a scout looking at a row whose PR landed
 *   between wakes. Nothing then matches: no events, no CI failure, no DAG, so `pendingAction` returns
 *   no work, and `readyToMerge` is false on a merged PR so no gate is surfaced either. The row idles
 *   permanently and the epic can never satisfy its wrap condition — a stall with nothing to explain it.
 *
 * Deriving only the first was the same one-sided fix this file has had to correct elsewhere: the rule
 * is "the merge decides", and a rule applied in one direction is a rule half-applied.
 * `multiPrPhase` owns multi-PR rows, whose evidence is `assembledGoal.passed` rather than one merge.
 */
function mergeDerivedPhase(row) {
  if (row.subPrs && row.subPrs.length) return null // multiPrPhase owns these
  if (row.phase === 'DONE') return row.merged ? null : 'PR_FEEDBACK'
  if (row.phase === 'PR_FEEDBACK' && row.merged) return 'DONE'
  return null
}

/**
 * Did the assembled end-to-end goal actually PASS?
 *
 * `passed` alone is not the answer. The inner `GOAL_SCHEMA` requires `evidence` — the command run and
 * what happened — precisely because a bare boolean is not a proof; but the outer `WORKER_SCHEMA`
 * carries `assembledGoal` as a free-form object, so `{ passed: true }` is schema-valid at the epic
 * boundary. Accepting it marks the issue DONE and mirrors it complete without the proof the whole
 * assemble phase exists to produce.
 *
 * Treating it as NOT passed (rather than refusing to finish the row) is the recoverable direction:
 * `multiPrHasWork` then still sees work and the next wake re-runs the goal. Refusing only the DONE
 * transition would park the row forever, which is how an earlier fix here turned a bypass into a stall.
 */
function goalPassed(goal) {
  return !!(goal && goal.passed && goal.evidence)
}

function multiPrPhase(row) {
  if (!row.subPrs || !row.subPrs.length) return null
  // BOTH conditions. Every sub-PR merged is necessary but not sufficient (the goal still has to be
  // proven) — and the goal passing is equally not sufficient on its own: a worker can report
  // `passed: true` while a slice is still pending or open, which would mark the issue DONE, stop all
  // DAG dispatch, and let Linear and the epic wrap before those PRs merge. Same shape as the
  // single-PR rule, whose evidence is its own merge.
  const allMerged = row.subPrs.every((s) => s.status === 'merged')
  return allMerged && goalPassed(row.assembledGoal) ? 'DONE' : 'PR_FEEDBACK'
}

/**
 * Does a multi-PR row have DAG work that needs no external event?
 *
 * `issue-multi-pr` is the only thing that knows its own ready set, so the worker reports
 * `multiPrPending` and that answer is trusted for one wake. Two things the row itself knows are
 * added, because they are external events that just landed: a sub-PR merged this wake (unblocking
 * whatever depended on it), and every slice being merged while the goal is still owed.
 */
function multiPrHasWork(row) {
  if (!row.subPrs || !row.subPrs.length) return false
  const goal = row.assembledGoal || {}
  // BOTH conditions, matching `multiPrPhase` exactly — that is the whole point. `multiPrPhase` requires
  // `allMerged && goalPassed` to call a row DONE, so a pass reported while a slice is still pending
  // leaves the phase at PR_FEEDBACK; suppressing DAG work on the pass ALONE then left that row with no
  // action and no gate (a pending slice has no PR to generate one), parked indefinitely. Two predicates
  // over the same state have to agree about what is finished, or the disagreement is the stall.
  if (goalPassed(goal) && row.subPrs.every((s) => s.status === 'merged')) return false
  // An ANSWERED escalation is work, and it has to be checked BEFORE the waiting states below — a
  // decision escalated from feedback on an OPEN repair PR is a `goal.fixPr && !fixMerged` row, which the
  // next line parks. (Not `fixBlocker`, as this comment first claimed: the resolution pass clears that
  // one before this predicate ever sees it, so ordering makes no difference to it.) This was the
  // read channel missing from the merge-gate guards added alongside it: the gate correctly withholds
  // while an answer is unapplied, the worker correctly reports `multiPrPending: false` while waiting
  // for the human, and nothing dispatched the worker that applies the answer — so the row sat with no
  // action and no gate forever. Requiring a live TARGET (a blockered slice or a blocked repair) keeps
  // this from burning a worker on a resolution that has nothing left to apply to.
  // Deliberately NO "is anything still blocked" condition. By the time this runs, the resolution pass
  // has already cleared the answered slice's nested blocker (and the row marker with it), so a
  // still-blocked target is exactly what a queued resolution does NOT have. Testing for one made this
  // guard unfireable. It cannot loop either: `nextRow` empties `blockerResolutions` once a worker ran,
  // so a queued answer buys exactly one dispatch — the one that spends it.
  if ((row.blockerResolutions || []).length) return true
  // The assemble phase's own WAITING states. Without these, a row whose repair PR is open reads as
  // "all slices merged, goal not passed" and dispatches a worker every wake — which finds nothing to
  // do (issue-multi-pr just reports AWAITING_FIX) and, worse, voids the merge readiness the repair
  // PR's own gate depends on, so the human is never asked to merge the very thing it waits for.
  if (goal.fixPr && !goal.fixMerged) return false
  if (goal.fixBlocker) return false
  if (row.multiPrPending) return true
  if (row.subPrMergedThisWake) return true
  return row.subPrs.every((s) => s.status === 'merged')
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
/**
 * Which queued human answers this wake did NOT spend.
 *
 * A multi-PR row's answers are delivered inside `issue-multi-pr`, and it serves only its ready set —
 * its own cap can defer a blocked slice whose answer is already in hand. Consuming the whole list on
 * "the nested workflow reported back" therefore discarded the deferred slice's answer, and the
 * coordinator re-asked the human a question they had already settled.
 *
 * A slice counts as unserved only if it carries the SAME blocker text it came in with: unchanged means
 * nothing was delivered for it, while a re-escalation (new text) means the answer WAS applied and
 * turned out to be insufficient, so re-handing it to the next worker would present a spent decision
 * as fresh.
 */
function unspentResolutions(row, subPrs, goal, worker) {
  const list = row.blockerResolutions || []
  if (!list.length) return []
  // A single-PR row's worker IS the delivery, so returning at all spends the answer.
  if (!(row.subPrs || []).length) return []
  // The nested workflow never reported, so nothing was delivered at all.
  if (worker.subPrs === undefined) return list
  const carried = new Map((row.subPrs || []).map((sp) => [sp.id, sp.blocker || null]))
  const byId = new Map((subPrs || []).map((sp) => [sp.id, sp]))
  const carriedGoal = row.assembledGoal || {}
  const nextGoal = goal || {}
  return list.filter((r) => {
    // A null `for` was aimed at whatever the row surfaced when it was given — `blockerFor` names it.
    const sp = byId.get(r.for || row.blockerFor)
    if (sp) {
      // A DIFFERENT blocker on the same slice means the answer was applied and proved insufficient, so
      // the question is new. Re-handing the old answer would present a spent decision as fresh.
      if (sp.blocker && sp.blocker !== carried.get(sp.id)) return false
      return sp.status === 'pending' || !!sp.blocker
    }
    // No slice target: this may be a REPAIR answer, which by design has no row in `subPrs`. It cannot be
    // recognised by `fixBlocker` — the resolution pass clears that field before this runs, and that
    // clearing IS how the answer's arrival is recorded — so the signal is a repair still OWED: a gap
    // issue filed with no fix PR open. Retained until the repair actually moves, because a repair worker
    // that returned `{ pr: null }` delivered nothing, exactly like one that died.
    // Retained while the repair is OWED, spent when a fix PR opens. Comparing the returned question
    // against the carried one is not available here: the resolution pass wipes `fixBlocker` before this
    // runs, so a worker echoing the same question is indistinguishable from one raising a new one. The
    // conservative direction is to keep the answer — the wake that retries the repair is exactly the one
    // that needs it, and the prompt already tells a worker to say so as a NEW blocker if the answer does
    // not fit the fork it hit. Bounded by the repair landing, not open-ended.
    if (nextGoal.fixIssue && !nextGoal.fixPr) return true
    // Nothing left to apply it to. Retaining it would restate a decision at every future worker
    // forever — the same call as a verdict on cancelled work: dropped, not hoarded.
    return false
  })
}

/**
 * Drop a goal proof that a newly added slice has invalidated.
 *
 * Only `passed`/`evidence` go — the failure, gap issue, repair handle and blocker are still true of
 * the work done so far, and clearing those would restart the gap/repair cycle from scratch.
 */
function invalidateGoalIfSliceAdded(goal, sliceAdded) {
  if (!goal || !sliceAdded || !goal.passed) return goal
  const { passed, evidence, ...rest } = goal
  return rest
}

function nextRow(row, { worker, action, landed, folded }) {
  // Carried + newly settled, minus whatever a RETURNING folder consumed. A dead folder consumes
  // nothing, so its verdicts stay for the next wake.
  const verdicts = folded ? landed : [...(row.verdicts || []), ...landed]

  // A goal proof covers the slice set it was RUN against. A late verdict can add a slice to a plan
  // whose goal already passed, and preserving that proof meant the row went DONE the moment the new
  // slice merged — end-to-end evidence that never exercised the code it was claiming to cover. The
  // same "false evidence" rule that stops a deduped POC verdict from being fanned to an untested path.
  // `worker || {}` because this function is also reached for rows that ran no worker at all, which
  // return before the merge below — they get the carried table and no invalidation, which is correct.
  const mergedSubPrs = (worker || {}).subPrs === undefined ? row.subPrs : mergeSubPrs(row.subPrs, worker.subPrs)
  const sliceAdded = (mergedSubPrs || []).some((s) => !(row.subPrs || []).some((p) => p.id === s.id))
  const mergedGoal = invalidateGoalIfSliceAdded(
    (worker || {}).assembledGoal === undefined ? row.assembledGoal : { ...(row.assembledGoal || {}), ...worker.assembledGoal },
    sliceAdded,
  )

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
  // The blocker text alone loses what the POC actually found. The coordinator is told to put the
  // question to the user WITH that evidence, and the thread handles are where the answer gets posted,
  // so the structured record is kept alongside — the same `unsettled` shape the epic path carries.
  const unsettledRecords = [
    ...(row.unsettled || []),
    ...unsettled
      .filter((v) => !(row.unsettled || []).some((u) => u.claim === v.claim))
      .map((v) => ({ claim: v.claim, evidence: v.evidence || null, threads: v.threads || null })),
  ]

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

  if (!worker) return { ...row, ...cursor, verdicts, ...(unsettledRecords.length ? { unsettled: unsettledRecords } : {}) }

  // See `specReviewRounds` below: a review round that reports no count is charged one, because
  // charging zero makes the budget unreachable.
  // A worker that escalated a `blocker` didn't finish the round any more than it finished reading
  // the batch — the cursor already holds for it, and this counter has to agree. Charged anyway, one
  // round becomes two, and after the human clears the blocker the retained batch reads as CONVERGED
  // and is never resumed: the budget guard silently eats the work it was protecting.
  const roundsSpent =
    !workerFinished
      ? 0
      : action === 'spec-review' && worker.specReviewRoundsSpent === undefined
        ? 1
        : worker.specReviewRoundsSpent || 0

  const next = {
    ...row,
    ...cursor,
    ...consumedFlags,
    phase: worker.phase || row.phase,
    // `== null`, not `=== undefined` — an explicit null from a worker wiped the handle the same way an
    // omission would have, and the guard only covered the omission.
    specPr: worker.specPr == null ? row.specPr : worker.specPr,
    implPr: worker.implPr == null ? row.implPr : worker.implPr,
    // Same rule for a multi-PR issue's sub-PR table: only a worker that reported one replaces it.
    // These are the handles the coordinator subscribes to, so silently clearing them would make
    // every sub-PR's review, CI and merge event invisible for the rest of the epic.
    // MERGED into the durable table, never substituted for it. A worker returns what it changed, and
    // a compact row that omits `dependsOn` would leave the slice reading as dependency-free — built
    // straight onto origin/main while its prerequisite is still unmerged, the DAG violated by a
    // field nobody meant to change. Structural edges come from the carried row; only observations
    // the worker actually reported are applied. A genuinely new slice is added as given.
    subPrs: mergedSubPrs,
    // Same rule as `subPrs`, and MERGED for the same reason: the schema permits a partial object, so a
    // worker reporting only what it changed (`{ fixPr: 42 }`, `{ fixMerged: true }`) would otherwise
    // drop the failure, the gap issue, the evidence and the blocker with it — and the next wake would
    // re-run the goal before an unmerged repair, or restart the gap/repair cycle from scratch.
    assembledGoal: mergedGoal,
    // Per-handle merge readiness was observed BEFORE this worker ran, and a worker pushes commits —
    // which invalidates an approval and re-runs checks. Surfacing the pre-worker observation would
    // tell the human to merge a head nobody has verified, so any worker that ran on this row voids
    // it and the next wake's scan re-establishes it.
    subPrStates: [],
    repairReadyToMerge: false,
    // Taken as given, because the schema REQUIRES it — there is no omission to interpret. Both earlier
    // rules were wrong in opposite directions: keying on the action ignored a `pr-feedback` worker that
    // did run the DAG, and preserving-on-omission made a `true` permanent (nothing ever reported the
    // false), so the row was dispatched every wake and starved the rest of the epic under the cap. The
    // prompt hands each worker the carried value and tells it to echo when it ran no DAG step, so
    // "always answer" costs no information.
    multiPrPending: !!worker.multiPrPending,
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
    // CONSUMED by this dispatch, which carried it in the prompt. A one-shot handoff, not durable
    // state: left set, every later worker on this row would be told an already-implemented decision
    // was fresh. A worker that DIED never reaches `nextRow`, so a failed dispatch leaves the
    // resolution intact for the retry — the same rule as the cursor.
    // ...but a MULTI-PR row's answer is delivered by the nested workflow, so `subPrs` coming back is the
    // receipt. An outer worker can satisfy this schema while never successfully running
    // `issue-multi-pr` — required fields present, `subPrs`/`assembledGoal` omitted — and consuming the
    // answer there left the decision spent with nothing applied, while the refresh had already cleared
    // the nested blocker so the unchanged PR became merge-eligible. A single-PR row is unaffected: its
    // worker IS the delivery, so returning at all is the receipt.
    blockerResolutions: unspentResolutions(row, mergedSubPrs, mergedGoal, worker),
    // A ONE-WAKE trigger, consumed by the worker that ran on it. Left set, a later wake whose refresh
    // scout died carried it forward and dispatched another worker on a merge already acted on — burning a
    // slot in the shared cap every time the scout failed. Unconditional here because this object is only
    // built when a worker RETURNED: the `if (!worker)` return above already preserves the trigger for a
    // row that ran none (cap-deferred, parked), which is where it is still owed.
    subPrMergedThisWake: false,
    blockerResolution: null,
    blockerResolutionFor: null,
    ...(unsettledRecords.length ? { unsettled: unsettledRecords } : {}),
    status: worker.status,
    verdicts,
  }

  // A freshly reported nested blocker is LIFTED to the row. `subPrs[].blocker` is the nested
  // workflow's native field, and a worker returning one has no obligation to also set the row-level
  // mirror — but the refresh rule reads an absent row-level blocker as "the human resolved it" and
  // clears the nested copy, destroying an escalation nobody has seen. Deriving the row-level field
  // from the nested ones makes the two consistent by construction: a fresh escalation always arrives
  // with its mirror, so the resolution rule only ever fires on a decision that was actually surfaced.
  // The marker is derived whether or not the row-level mirror is present. Deriving it only when the
  // mirror was ABSENT meant a worker that returned both channels — which the schema invites, and which
  // is the natural thing for a worker to do — got no `blockerFor` at all. The resolution pass needs it
  // to clear the right nested blocker, so without it the answered slice kept its blocker, the refresh
  // re-lifted the identical question, and the row parked with the answer never dispatched.
  const nestedBlocked = (next.subPrs || []).find((sp) => sp.blocker)
  if (!next.blockerFor && nestedBlocked) {
    // Prefer the slice the row-level text actually names (`a: ...`), since a worker that mirrored
    // properly has told us which one; fall back to the queue head, the same order the re-lift uses.
    const named = (next.subPrs || []).find((sp) => sp.blocker && String(next.blocker || '').startsWith(`${sp.id}: `))
    next.blockerFor = (named || nestedBlocked).id
  }
  if (!next.blocker) {
    const nested = nestedBlocked
    if (nested) {
      next.blocker = `${nested.id}: ${nested.blocker}`
      // Which slice this answer will release. Without it, resolving one decision clears every nested
      // blocker, including a sibling's that nobody answered.
      next.blockerFor = nested.id
    } else if (next.assembledGoal && next.assembledGoal.fixBlocker) {
      // The THIRD copy, and it needs the lift for exactly the same reason the second one did. A repair
      // worker escalates by setting `assembledGoal.fixBlocker`; the outer worker has no obligation to
      // also set the top-level `blocker`, and this lift only looked at `subPrs[]`. So the decision was
      // never surfaced — and the next refresh, reading an absent row blocker as "the human answered",
      // cleared `fixBlocker` and let the repair proceed through a fork nobody decided. Deriving the row
      // field from every nested copy is what makes the resolution rule safe to apply at all.
      next.blocker = `repair: ${next.assembledGoal.fixBlocker}`
      next.blockerFor = null
    }
  }

  // A transition without its durable handle is refused. The schema requires `phase` but cannot make
  // `specPr`/`implPr` conditionally required, so a spec worker could report AWAITING_SPEC_APPROVAL
  // with no spec PR — an approval gate with nothing to open — and an implement could report
  // PR_FEEDBACK with no impl PR, leaving every later refresh scanning "Impl PR: none" and the PR's
  // reviews, CI and subscription invisible. Keeping the old phase means the next wake retries the
  // transition, which is the recoverable outcome; accepting it strands the issue behind a handle
  // that will never appear.
  const needs = { AWAITING_SPEC_APPROVAL: 'specPr', PR_FEEDBACK: 'implPr' }
  const needed = needs[next.phase]
  // A multi-PR row's implementation handles live in `subPrs`, so it satisfies PR_FEEDBACK without
  // an `implPr` — that is the whole point of the sub-PR table.
  const hasSubPrs = !!(next.subPrs && next.subPrs.length)
  if (needed && next.phase !== row.phase && !next[needed] && !(needed === 'implPr' && hasSubPrs)) {
    next.phase = row.phase
    next.handleMissing = { phase: worker.phase, needed }
  } else if (next.handleMissing) {
    next.handleMissing = null
  }

  // The derived phase wins over the worker's too, not just the scout's. A worker finishing the last
  // sub-PR will reasonably report DONE — and that is precisely the premature completion the rule
  // exists to prevent, since the merges do not satisfy the assembled goal. Deriving it in only one
  // of the two places it can be set is deriving it nowhere.
  const derived = multiPrPhase(next) || approvalGatedPhase(next) || mergeDerivedPhase(next)
  return derived && derived !== next.phase ? { ...next, phase: derived } : next
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
  // Work that AUTHORS against the objective — a spec, or an implementation of one. When this wake is
  // also folding epic-PR feedback, the fold may commit an objective or cross-cutting change, so that
  // work would start from direction this wake is in the middle of revising. It is deferred ONE wake,
  // not re-gated: the next wake dispatches it against the folded head with the approval intact.
  // (Review raised the stronger form — hold until the objective is re-approved — twice; that one
  // deadlocks, because folding is how the objective becomes approvable at all. This is the narrow
  // version that removes the risk without the deadlock.)
  // `spec-review` belongs here for the same reason the other two do, and was missed because the set was
  // built from "creates a spec" rather than "writes against the objective". Folding review feedback into
  // an existing spec is authoring: the worker is aligned to the pre-fold `epicHead`, and if the fold
  // changes the objective or a cross-cutting decision it commits — and SPENDS A REVIEW ROUND — against
  // direction that no longer holds. That round is not refundable, which makes this the most expensive
  // of the three to get wrong. Deferring it one wake is safe in the way the others are: the epic fold
  // doesn't wait on a child spec review, so nothing deadlocks, and the row keeps its cursor so the
  // batch is genuinely re-derived rather than consumed.
  const AUTHORS_AGAINST_OBJECTIVE = new Set(['spec', 'spec-review', 'implement'])
  const heldForFold = []

  for (const row of rows) {
    if (row.blockedBy && row.blockedBy.length) {
      blocked.push(row)
      continue
    }
    const next = pendingAction(row)
    if (next && foldEpicWanted && AUTHORS_AGAINST_OBJECTIVE.has(next.action)) {
      heldForFold.push({ row, ...next })
      continue
    }
    if (next) actionable.push({ row, ...next })
    else if (row.phase === 'AWAITING_SPEC_APPROVAL' && row.newSpecReviewEvents) converged.push(row)
    else waiting.push(row)
  }

  const held = epicApproved ? [] : actionable
  // Priority inverts while a fold is pending: the fold is what the held work is waiting for, so
  // starving it behind other dispatches would defer that work for nothing. It takes a slot INSIDE
  // the cap by displacing one advance, never by exceeding it — the cap is documented as shared
  // across issue workers, folds and settlements, and an epic-agent fold is a full worktree like
  // any other. The displaced advance is deferred, which the log already reports.
  const foldReservesSlot = foldEpicWanted && heldForFold.length > 0
  const advanceCap = foldReservesSlot ? Math.max(0, cap - 1) : cap
  const advance = epicApproved ? actionable.slice(0, advanceCap) : []
  const deferred = epicApproved ? actionable.slice(advanceCap) : []

  const foldEpic = foldEpicWanted && (foldReservesSlot || advance.length < cap)
  const settle = claims.slice(0, Math.max(0, cap - advance.length - (foldEpic ? 1 : 0)))
  const queuedClaims = claims.slice(settle.length)

  return { advance, deferred, held, blocked, converged, waiting, foldEpic, settle, queuedClaims, heldForFold }
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
  // Bound by ATTRIBUTABILITY, not completeness — the weaker of `subPrScanBinding`'s two questions.
  // A partial scan's answered handles are still good data, and `cursorUsable` separately refuses to
  // let an incomplete scan consume the row's activity, so folding what it did answer cannot lose
  // anything. What is refused outright is an unattributable scan: a `merged: true` landing on the
  // wrong handle marks the wrong node merged, and a dependent then builds off origin/main before its
  // real prerequisite has landed.
  const binding = subPrScanBinding(row.subPrs, fresh && fresh.subPrStates)
  if (binding) {
    out.subPrs = row.subPrs.map((s) => {
      const live = binding.byId.get(s.id)
      // Only ever ADVANCE a sub-PR to merged. A scan that omits an entry says nothing about it, and
      // demoting an open sub-PR to pending would have the next wake rebuild it from scratch.
      return live && live.merged && s.status !== 'merged' ? { ...s, status: 'merged' } : s
    })
    // A merge is the external event that unblocks the next slice, and it is not "PR activity" —
    // `pendingAction` needs to know it happened THIS wake or the DAG stalls right there.
    out.subPrMergedThisWake = out.subPrs.some((s, i) => s.status === 'merged' && row.subPrs[i].status !== 'merged')
  } else if (row.subPrs && row.subPrs.length && fresh && fresh.subPrStates && fresh.subPrStates.length) {
    // Reported, and not attributable to any handle. Worth naming: the scan looked and its whole answer
    // was thrown away, which is a scout bug, not a quiet row.
    out.subPrScanUnattributable = true
  }
  // A sub-PR's own `blocker` is the third copy of the same human decision (row, assembledGoal, and
  // here), and `classify()` refuses to dispatch a slice while it is set. The documented resolution
  // path clears the row-level one, so a nested copy left behind parks that slice permanently. Same
  // rule as `fixBlocker`: the row-level field is where the human is answered, and these follow it.
  // Only the ONE the row-level field represents. Two sub-PR workers can escalate different decisions
  // in the same wake, and the row surfaces the first; clearing all of them on that answer would let
  // the sibling's slice resume on a decision nobody made. The lift prefixes the id (`a: ...`), so the
  // answered slice is identifiable and the next wake lifts the next unanswered one — a queue, which
  // terminates, rather than a single field pretending to hold several decisions.
  if (!row.blocker) {
    const base = out.subPrs || row.subPrs || []
    // ONLY the slice `blockerFor` names. The fallback that used to pick "the first nested blocker"
    // when no slice was named had a window: after clearing the answered one and its marker, a wake
    // with no DAG work runs no worker, so nothing lifts the next sibling — and the following refresh
    // saw no blocker and no marker, took the fallback, and cleared a decision nobody had answered.
    // A row with nested blockers and no marker (legacy, or exactly that window) gets one LIFTED
    // below instead of cleared, which is the fail-closed direction.
    if (row.blockerFor && base.some((s) => s.id === row.blockerFor && s.blocker)) {
      out.subPrs = base.map((s) => (s.id === row.blockerFor ? { ...s, blocker: null } : s))
    }
    // Re-lift in the SAME pass, so the invariant "nested blockers imply a row-level marker" holds at
    // every wake boundary rather than only on wakes that happen to run a worker.
    const remaining = (out.subPrs || base).find((sp) => sp.blocker)
    if (remaining) {
      out.blocker = `${remaining.id}: ${remaining.blocker}`
      out.blockerFor = remaining.id
    } else if (row.blockerFor) {
      out.blockerFor = null
    }
    // NOTE — deliberately no re-lift of `assembledGoal.fixBlocker` here, unlike the nested sub-PR
    // blockers above. `nextRow` lifts it the moment a worker reports it, so a row reaching this branch
    // with a `fixBlocker` and no row blocker means the human just ANSWERED it. Re-lifting would restate
    // the question being answered and park the row behind it forever — the clearing rule below is the
    // correct reader of this state. (Tried the symmetric version; it deadlocked.)
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

/**
 * Fold a worker's reported sub-PR rows into the durable table.
 *
 * Keyed by id, which is right here (unlike a positional bind) because the worker is echoing ids the
 * script gave it and the set may legitimately grow. What must NOT come from the response is the
 * structural part of the plan: `dependsOn` is the DAG, and a compact row omitting it reads as
 * dependency-free.
 *
 * @param carried  the durable table (may be undefined for a first report)
 * @param reported the worker's rows
 */
function mergeSubPrs(carried, reported) {
  // Normalized to ONE spelling on the way in, so no later reader has to know there are two. Absence
  // stays absence — a slice with no declared edges gains no key it didn't have.
  const norm = (n) => {
    if (n.dependsOn === undefined && n.depends_on === undefined) return n
    const { depends_on, ...rest } = n
    return { ...rest, dependsOn: dependsOnOf(n) }
  }
  const byId = new Map((carried || []).map((s) => [s.id, norm(s)]))
  for (const r of reported) {
    const prev = byId.get(r.id)
    const reportedEdges = r.dependsOn !== undefined || r.depends_on !== undefined
    const merged = { ...(prev || {}), ...norm(r) }
    // STATUS is an observation, and a worker is not the observer. Workers build and push; they never
    // merge, and only the refresh scout reads PR metadata. An unrestricted spread let a worker echoing
    // the table promote a slice to `merged` — which unlocks dependents onto `origin/main` and can run the
    // assembled goal while that PR is still open — or demote an open one to `pending`, which the next
    // wake rebuilds from scratch. The one transition a worker genuinely owns is pending → open: it just
    // opened the PR. Everything else comes from `foldMultiPrScan`.
    if (prev && merged.status !== prev.status) {
      const workerOwns = prev.status === 'pending' && merged.status === 'open'
      if (!workerOwns) merged.status = prev.status
    }
    // A NEW slice cannot be `open` without both handles. The transition guard above only runs when
    // there IS a carried row, so a worker revising the PR plan could insert `{ id, status: 'open' }` with
    // no `pr` and no `branch` — schema-valid, and permanently stuck: `classify` has no action for an
    // ordinary open node, there is no handle for the scout to refresh, and no merge gate can name it.
    // Demoted to `pending`, the next wake simply builds it, which is what the worker meant.
    if (!prev && merged.status === 'open' && !(merged.pr && merged.branch)) {
      log(`${r.id}: worker added it as open with no PR/branch — entering it as pending so it gets built.`)
      merged.status = 'pending'
    }
    // Structural edges come from the carried row unless the worker actually reported them.
    if (!reportedEdges && prev && prev.dependsOn !== undefined) merged.dependsOn = prev.dependsOn
    byId.set(r.id, merged)
  }
  return [...byId.values()]
}

function approvedInSessionFor(row, fresh, refreshedLive) {
  const at = row.approvedInSession
  if (!at) return false
  // A LIVE scan that returns no head is not a usable observation — same rule the epic gate follows.
  // Falling back to the carried head there would approve against a SHA the scan just failed to
  // confirm: if the spec PR has moved and `approvedInSession` matches the old head, implementation
  // starts on direction the human never saw. Only an ABSENT refresh (the scout died) falls back, and
  // then to the carried head rather than to "nothing contradicts it", because a previous wake may
  // already have observed and persisted a push past the approved SHA.
  if (refreshedLive) return !!(fresh && fresh.headSha) && fresh.headSha === at
  const head = row.headSha || null
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
/** CONFIRMED / REFUTED — the ones whose evidence actually resolves the claim. */
const settledVerdicts = (verdicts) => (verdicts || []).filter((v) => v.verdict !== 'INCONCLUSIVE')
/** INCONCLUSIVE — evidence that resolves nothing; orchestration.md hands the question to the human. */
const unsettledVerdicts = (verdicts) => (verdicts || []).filter((v) => v.verdict === 'INCONCLUSIVE')

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
        // `blockedBy` is REQUIRED. It gates admission to the active set, and the code reads a present
        // row as authoritative — so an omission meant "no blockers" and dispatched an issue
        // concurrently with the prerequisite it is waiting on. An unblocked issue says `[]`.
        required: ['id', 'state', 'blockedBy'],
        properties: {
          id: { type: 'string' },
          state: { type: 'string' },
          blockedBy: { type: 'array', items: { type: 'string' }, description: 'Open blocked-by relations; [] when there are none' },
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
  // `headSha` is required because it now GATES the scan-derived approval, which is this PR's standing
  // rule for any field an action depends on — and the epic gate's own schema has always required it.
  // `['string','null']` still lets a scout say "did not observe"; what it can no longer do is stay
  // silent and have the approval accepted anyway.
  required: ['issueId', 'phase', 'specApproved', 'newSpecReviewEvents', 'newPrEvents', 'readyToMerge', 'merged', 'ciFailed', 'headSha'],
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
      description:
        'One entry per sub-PR handle given in the prompt. Omit for a single-PR issue; on a multi-PR row it is MANDATORY — a scan that leaves it out is treated as an incomplete observation and consumes nothing.',
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
  // `multiPrPending` is required for the same reason `readyToMerge` is, and it was the harder lesson.
  // Optional, with a prompt that asked only for the true case, it had no clearing path at all: an
  // omission preserved the carried `true` (it had to — a worker that omitted it must not strand
  // cap-deferred slices), so once set it was set forever, and `multiPrHasWork` then made the row
  // actionable on every wake. With a cap of 2 and a stable row order that starves every other issue
  // in the epic indefinitely. Required means the answer is always given, so there is nothing to guess.
  required: ['issueId', 'phase', 'readyToMerge', 'multiPrPending'],
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
          // Constrained for the same reason `phase` is: `issue-multi-pr`'s classify() handles exactly
          // these, so a typo or a descriptive value like "done" is schema-valid, gets persisted, and
          // then produces no build, rebase, merge or assemble action — the slice stalls silently.
          status: { type: 'string', enum: ['pending', 'open', 'merged'] },
          pr: { type: ['number', 'null'] },
          branch: { type: ['string', 'null'] },
          stackedOn: { type: ['string', 'null'] },
          dependsOn: { type: 'array', items: { type: 'string' }, description: 'Only if the plan itself changed — omit to keep the carried edges' },
          blocker: { type: ['string', 'null'], description: 'This slice needs a human decision' },
        },
      },
    },
    multiPrPending: {
      type: 'boolean',
      description:
        'Does this issue\'s DAG still have work needing no external event (a ready or cap-deferred sub-PR, or an assemble step), so it should be dispatched again next wake? Single-PR issues: false. Multi-PR issues where you did NOT run a DAG step: echo the value the prompt gave you — do not guess false, which would strand slices no event will wake.',
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
  // `folded` is required so a fold always says what it did: it is the coordinator's only window into an
  // artifact it deliberately never reads, and an empty string is a legitimate answer ("nothing changed").
  required: ['roundsSpent', 'aboveBar', 'folded'],
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
    // The epic-agent's contract tells it to return open questions when a cross-cutting decision needs
    // a human (its `open_questions` line). Without the field here, `additionalProperties: false`
    // rejects that response, the harness returns null, the wake reads "the fold died" and retries
    // forever — while the question itself never reaches anyone. A contract the schema refuses is a
    // stall, and the two have to agree.
    openQuestions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Cross-cutting decisions that need a human, one line each. Omit or [] when there are none.',
    },
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
// A LIVE scan is authoritative even when it is incomplete. `headSha` is what workers align to, so a
// scan that returns none cannot release anything — falling back to the carried approval would ramp
// child workers against a possibly-superseded objective SHA. The durable approval is only for the
// case where there was no scan at all (the scout died); an infrastructure failure must not re-lock
// an epic that was already signed off, but a partial observation must not release one either.
const scanned = !!gate
const gateUsable = !!(gate && gate.headSha)
if (scanned && !gate.headSha) {
  log(
    `Epic gate scan returned no current head — holding work this wake rather than aligning to a stale objective${gate.approved ? ' (it reported approval, which needs a head to be actionable)' : ''}.`,
  )
}
// Holding the CURRENT wake is not enough: the hold has to survive into the next one. A headless scan
// left `approved: true` persisted next to the old head, so a dead scout on the following wake took the
// dead-scout branch, read the durable `true`, and released every child worker against an objective the
// last real observation could not confirm was current. `headUnconfirmed` is that hold made durable —
// set by a live scan with no head, cleared by any usable scan, and preserved (like the approval
// itself) when there was no scan at all.
const epicApproved = scanned ? gateUsable && !!gate.approved : !!epic.approved && !epic.headUnconfirmed
let headUnconfirmed = scanned ? !gateUsable : !!epic.headUnconfirmed
if (!scanned && epic.headUnconfirmed && epic.approved) {
  log(
    `Epic gate scout died and the last live scan could not confirm the objective head — holding child work rather than releasing it against an unconfirmed approval.`,
  )
}

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
// The subset where the WORK IS GONE, as opposed to finished. A verdict can still be folded into completed
// work (the spec is there, the thread is there); there is nothing to fold it into on cancelled work.
const CANCELLED_LINEAR = /^(cancell?ed|duplicate|dropped|wo?n'?t ?do)$/i
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
    // Durable handles survive a scan that reports them as null. Both are declared `['number','null']`,
    // so a scout omitting or nulling one was schema-valid and the spread destroyed it: an
    // AWAITING_SPEC_APPROVAL row would emit an approval gate with no PR to approve, and a PR_FEEDBACK
    // row would lose the handle its subscription and merge gate are derived from — with no action able
    // to recover either, since nothing re-derives a PR number from scratch. BP-030: tolerate the old
    // shape, and treat null as "did not observe" rather than "no longer exists". The cost is a closed
    // spec PR staying on the row until a worker replaces it, which is visible; the alternative was a
    // gate pointing at nothing, which is not.
    specPr: fresh.specPr == null ? row.specPr : fresh.specPr,
    implPr: fresh.implPr == null ? row.implPr : fresh.implPr,
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
    // And a HEAD, for the reason `approvedInSessionFor` already enforces one function away: an approval
    // that names no head cannot be shown to apply to the spec PR's current content, so accepting it
    // dispatched implementation on direction the human may never have seen. The scan channel was the
    // looser of the two, which is backwards — it is the one with no human in the loop this wake.
    specApproved: (refreshedLive ? !!(fresh.specApproved && fresh.headSha) : false) || approvedInSessionFor(row, fresh, refreshedLive),
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
    // Whether the scan ANSWERED about the repair PR, as distinct from what it answered. `false` and
    // "didn't look" have opposite meanings here (see cursorUsable), and one boolean can't carry both.
    repairScanned: refreshedLive && fresh.repairMerged !== undefined,
    // A headless scan must not ERASE the last confirmed head. Spreading `fresh` persisted the null,
    // and then a dead scout on the next wake read "no observed head" as compatible with any
    // `approvedInSession` SHA — implementation dispatched without the approved head ever being
    // confirmed current. The last thing we actually saw is better evidence than nothing.
    headSha: (fresh && fresh.headSha) || row.headSha || null,
    linearState: li.state || row.linearState,
    linearTerminal: linearById.has(row.id) ? TERMINAL_LINEAR.test((li.state || '').trim()) : !!row.linearTerminal,
    // Distinguish "the refresh didn't see this row" from "the refresh saw it and it has no
    // blockers". A present row is authoritative and CLEARS a resolved blocker (its absent
    // `blockedBy` is schema-valid and means none); an absent row means the scout died or
    // skipped it, so the carried relation stands. Getting this backwards either un-blocks an
    // issue on a failed refresh or blocks it forever after its prerequisite merged.
    blockedBy: linearById.has(row.id) ? li.blockedBy || [] : row.blockedBy || [],
    // Counters are the coordinator's, never the scout's — they survive across wakes.
    specReviewRounds: carriedCount(row, 'specReviewRounds', 'spec_review_rounds'),
    specLevelFound: carriedFlag(row, 'specLevelFound', 'spec_level_found'),
    // Carried human decisions, as a list and aimed. Computed from the CARRIED row so an untargeted
    // answer can still be attributed to the slice the row surfaced — `foldMultiPrScan` below lifts the
    // next sibling over `blockerFor`, and after that the aim is unrecoverable.
    blockerResolutions: normalizeResolutions(row),
    blockerResolution: null,
    blockerResolutionFor: null,
    // A multi-PR row's live handles: merged sub-PRs, a merged repair, a resolved repair blocker.
    ...foldMultiPrScan(row, fresh),
  }
})
  // Derived AFTER the fold, because it reads the freshly-merged sub-PRs and the folded goal. A
  // scout naming this phase either finishes the issue without its assembled goal or stalls it.
  .map((row) => {
    const derived = multiPrPhase(row) || approvalGatedPhase(row) || mergeDerivedPhase(row)
    return derived && derived !== row.phase ? { ...row, phase: derived } : row
  })

for (const r of refreshed) {
  if (r.subPrScanUnattributable) {
    log(
      `${r.id}: refresh reported sub-PR states whose ids don't match the handles they were asked about (${(r.subPrs || [])
        .map((sp) => sp.id)
        .join(', ')}) — the scan was discarded rather than applied to the wrong slices, and this row consumes no activity this wake.`,
    )
  }
  const rGoal = r.assembledGoal || {}
  if (rGoal.fixPr && !rGoal.fixMerged && !r.repairScanned && (r.newPrEvents || r.newSpecReviewEvents)) {
    log(
      `${r.id}: refresh reported activity but no repairMerged for open repair PR #${rGoal.fixPr} — treating the scan as incomplete, so the activity stays live rather than consuming a merge nobody looked for.`,
    )
  }
}

const claims = dedupeClaims(requests)
if (claims.length < requests.length) {
  log(`Deduped ${requests.length} settlement request(s) into ${claims.length} claim(s).`)
}

// The epic PR is a direction artifact on the same budget as an issue spec — the one surface
// where an unbounded review loop would otherwise sit directly on the top-level gate.
const newEpicReviewEvents = !!(gate && gate.newReviewEvents)
// GATE_SCHEMA permits `newReviewEvents: true` with a null timestamp, and that combination cannot
// advance a cursor. Folding under it spends a review round on a batch the next wake rediscovers.
const epicCursorMovable = !(newEpicReviewEvents && !(gate && gate.latestActivityAt))
if (!epicCursorMovable) {
  log('Epic gate reported new review activity with no timestamp — the cursor cannot advance past it, so it is left live to be re-derived rather than folded and lost.')
}
const epicReviewRounds = carriedCount(epic, 'reviewRounds', 'epic_review_rounds')
const epicAtBudget = atReviewBudget(epicReviewRounds, epic.aboveBarFound)
// A POC verdict on a cross-cutting claim is folded regardless of the budget — new evidence is
// not another opinion (orchestration.md § "What it costs").
const epicVerdictsToFold = epic.verdicts && epic.verdicts.length ? epic.verdicts : null
// The human's ANSWERS to questions this epic asked — `openQuestions` and `unsettled` claims alike.
//
// Both were persisted, re-surfaced every wake, and dropped by the coordinator once answered, which
// made the question durable and its answer nothing at all: no field held it, no prompt carried it to
// `epic-agent`, and no fold was triggered by it — so unless unrelated review activity happened to
// arrive, the epic-spec was never updated and every child issue kept working against the unresolved
// version. A question surfaced forever is better than one dropped; a question ANSWERED and dropped is
// the same loss with the audit trail removed.
//
// Modelled on `verdicts`, which is the same shape one step earlier (new information that has to reach
// the spec): it triggers a fold on its own, is carried until a fold returns to consume it, and is
// exempt from the review budget — an answer to a question we asked is not another opinion.
const epicAnswersToFold = epic.answers && epic.answers.length ? epic.answers : null
// The verdict's budget exemption covers the VERDICT ONLY. When a carried verdict and ordinary
// converged review feedback coexist, folding both would let the evidence exemption smuggle in a
// full extra review round — so the two paths run side by side: the fold takes the verdict, and
// the converged feedback still goes out through the notes route.
const foldEpicWanted =
  !!epicVerdictsToFold || !!epicAnswersToFold || (epicCursorMovable && newEpicReviewEvents && !epicAtBudget)
// At budget the epic-spec stops being FOLDED — but the feedback still has to be ROUTED, or
// convergence silently drops it. The gate scout returns only a boolean and a timestamp, so
// nothing here knows what the comments said or which issues they touch: that needs its own
// cheap read. Without it this branch logged "routed as implementer notes" while routing nothing.
// The cursor guard applies to the ROUTE as well as the fold — it was only on `foldEpicWanted`, so a
// converged epic re-read and re-routed the same comments as implementer notes on every wake.
const routeConvergedEpicFeedback = epicCursorMovable && newEpicReviewEvents && epicAtBudget
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
// No silent holds: this one has a cause the user can act on (the epic PR has feedback in flight).
if (plan.heldForFold.length) {
  log(
    `Holding ${plan.heldForFold.map((h) => `${h.row.id}(${h.action})`).join(', ')} for one wake — the epic-spec is being folded, and these author against the objective it may change. The fold takes priority this wake; they dispatch next wake against the folded head with their approvals intact.`,
  )
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

// A claim in flight or queued for this issue, at DISPATCH time. (`contestedClaimFor` below is the
// richer disclosure view, but it is built after the workers have run.)
const settlingClaimFor = (issueId) => {
  const hit = [...plan.settle, ...plan.queuedClaims].find((c) => (c.issues || [c.issueId]).includes(issueId))
  return hit ? hit.claim : null
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
            ? // SETTLED ones only get the "record as resolved" instruction. An INCONCLUSIVE verdict resolves
              // nothing — `nextRow` turns it into a human decision AFTER this worker returns, so telling
              // the worker to fold every verdict had it write "resolved with evidence" into the spec and
              // the thread for a question the human had not answered yet. Recording a claim as settled
              // when it is not is the false-evidence failure orchestration.md forbids, and it lands in
              // artifacts a later reader trusts.
              (settledVerdicts(item.row.verdicts).length
                ? `POC settlement(s) landed on this issue. Apply them per issue-spec 6.5.3 BEFORE anything else — fold each verdict, post the evidence-backed reply on its thread, and record the claim as resolved-with-evidence in the spec's §12:\n${renderVerdicts(settledVerdicts(item.row.verdicts))}\n`
                : '') +
              (unsettledVerdicts(item.row.verdicts).length
                ? `A POC came back INCONCLUSIVE on ${unsettledVerdicts(item.row.verdicts).length} claim(s). ` +
                  `Do NOT record these as resolved and do NOT fold a conclusion into the spec — the evidence settles nothing and the decision is the human's. ` +
                  `Post what the POC actually found on the thread, leave the claim open in §12, and report it back unchanged so the coordinator can put it to them:\n${renderVerdicts(unsettledVerdicts(item.row.verdicts))}\n`
                : '')
            : '') +
          // The decision this row escalated, and the human's answer to it. The escalating worker is
          // gone and you are a fresh agent in a fresh worktree: without this you reach the identical
          // fork, and your only options are to escalate the same question again or to invent the
          // answer the gate existed to supply.
          (item.row.blockerResolutions && item.row.blockerResolutions.length
            ? `${item.row.blockerResolutions.length === 1 ? 'A decision' : `${item.row.blockerResolutions.length} decisions`} this issue escalated ${item.row.blockerResolutions.length === 1 ? 'has' : 'have'} been ANSWERED by the human:\n` +
              item.row.blockerResolutions.map((r) => `  - ${r.for ? `[${r.for}] ` : ''}${r.answer}`).join('\n') +
              `\nThose are decisions, not suggestions — implement them as given rather than re-deriving the choice, and do not escalate the same forks again. A \`[slice]\` prefix names which sub-PR the answer belongs to. If one turns out not to answer the fork you actually hit, say so as a new \`blocker\` naming precisely what is still open.\n`
            : '') +
          (item.action === 'implement' && settlingClaimFor(item.row.id)
            ? `A POC settlement is IN FLIGHT on a load-bearing claim for this issue: ${settlingClaimFor(item.row.id)}. Chain into implementation as normal, but do NOT close or delete the spec PR or its branch yet — a REFUTED verdict has to be folded into that live artifact and replied to on its thread. The coordinator closes it once the claim is settled.\n`
            : '') +
          (item.action === 'implement' && item.row.newSpecReviewEvents
            ? `The approving batch on spec PR ${item.row.specPr || '(the spec PR)'} ALSO carries outstanding review feedback. Read it and carry it as implementer notes BEFORE you close the spec PR — do not spend a review round on it and do not fold it into the spec. This is the only pass that sees it: nothing looks at spec-PR review activity once this row reaches PR_FEEDBACK.\n`
            : '') +
          // `issue-multi-pr` only builds pending nodes, rebases stacked ones and advances assembly —
          // it has no notion of an ordinary open PR's review comments. Dispatched for `pr-feedback`
          // and pointed straight at the DAG, the row reports "waiting", the cursor advances, and the
          // batch is consumed unfixed. So the feedback is handled FIRST, on whichever handle carries
          // it, and only then does the DAG step run.
          (item.action === 'pr-feedback' && item.row.subPrs && item.row.subPrs.length
            ? `The activity is on one of this issue's sub-PRs or its assembled-goal repair PR — NOT on a single impl PR. Handle it the way issue-implement handles PR feedback (address or answer each comment, fix failing CI) on the handle that carries it, BEFORE any DAG step. Handles: ${item.row.subPrs
                .map((sp) => `${sp.id}=${sp.pr ? `#${sp.pr}` : 'not opened'}`)
                .join(', ')}${item.row.assembledGoal && item.row.assembledGoal.fixPr ? `, repair=#${item.row.assembledGoal.fixPr}` : ''}.\n`
            : '') +
          // ...but never for `apply-decision`: that dispatch records a human's answer on a row whose phase
          // has nothing to advance (a terminal issue, or one whose phase yielded no action), so pointing
          // it at the DAG would invite a step nobody asked for.
          (item.action !== 'apply-decision' && item.row.subPrs && item.row.subPrs.length
            ? `This issue implements as a DAG of sub-PRs. Advance it with the issue-multi-pr workflow, passing this state as its args, and return the updated subPrs table AND assembledGoal.\n` +
              `  subPrs: ${JSON.stringify(item.row.subPrs)}\n` +
              // The worker runs in an isolated worktree and cannot read `.orchestration/`, so state
              // it isn't handed does not exist for it. Given only `subPrs`, a resumed issue would
              // re-run the end-to-end goal and file a second repair for a gap already tracked.
              `  assembledGoal: ${JSON.stringify(item.row.assembledGoal || {})}\n` +
              `  multiPrPending (carried): ${!!item.row.multiPrPending}\n` +
              // The nested workers are the ones that hit the fork, so the answer has to travel with the
              // args — telling YOU the decision and stopping there leaves the freshly-spawned build or
              // fix worker at the same fork, able only to escalate again or guess. One hop short is the
              // same defect as no channel at all.
              (item.row.blockerResolutions && item.row.blockerResolutions.length
                ? `  blockerResolutions: ${JSON.stringify(item.row.blockerResolutions)}\n` +
                  `Pass those through to issue-multi-pr as well — its build and fix workers are the ones that escalated, and they are freshly spawned with none of this context.\n`
                : '') +
              `ALWAYS report multiPrPending — true if the DAG still has work that needs no external event (a ready or cap-deferred sub-PR, or an assemble step) so the next wake dispatches you again rather than waiting for an event that will never come, false once it has drained. If you did not run a DAG step this pass, echo the carried value above rather than answering false: guessing false strands slices that no external event will wake, and there is no other channel that can set it again.\n` +
              // A malformed plan (duplicate id, dependency cycle, unknown dependency) dispatches
              // nothing and only a human can fix it, so it has to come back as a BLOCKER. Returned
              // as neither work nor blocker nor gate, the row simply sits in PR_FEEDBACK forever.
              `If it reports any sub-PR as invalid (duplicate id, dependency cycle, unknown dependency), return that as your \`blocker\` — it needs a human to fix the PR plan and nothing else can advance it.\n`
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
          ? // Same split as the issue prompt: only a SETTLED verdict may be written in as a decision.
            (settledVerdicts(epicVerdictsToFold).length
              ? `A POC settled ${settledVerdicts(epicVerdictsToFold).length} cross-cutting claim(s) for this epic. Fold them FIRST and record each in the epic-spec's cross-cutting decisions so a sibling issue can't reopen it:\n${renderVerdicts(settledVerdicts(epicVerdictsToFold))}\n`
              : '') +
            (unsettledVerdicts(epicVerdictsToFold).length
              ? `A POC came back INCONCLUSIVE on ${unsettledVerdicts(epicVerdictsToFold).length} cross-cutting claim(s). Record what it found, but do NOT write a decision — the call is the human's and the coordinator will put it to them. Report them back unchanged:\n${renderVerdicts(unsettledVerdicts(epicVerdictsToFold))}\n`
              : '') +
            `Post the evidence-backed reply on the thread. This fold is outside the review budget — new evidence is not another opinion.\n\n`
          : '') +
        (epicAnswersToFold
          ? `The human ANSWERED ${epicAnswersToFold.length} open question(s) this epic asked. Fold each into the epic-spec as a recorded decision — in cross-cutting decisions if it is one, otherwise wherever the question was raised — so no sibling issue reopens it and every child worker reads the resolved version:\n` +
            epicAnswersToFold.map((a) => `  - Q: ${a.question}\n    A: ${a.answer}`).join('\n') +
            `\nReply on the thread where the question was raised if there is one. This fold is outside the review budget — an answer to a question we asked is not another opinion. These are DECISIONS: record them as given rather than re-deriving or re-opening them.\n\n`
          : '') +
        (epicAtBudget || !newEpicReviewEvents
          ? `Fold what is listed above and NOTHING ELSE — there is no new review feedback to fold${epicAtBudget ? ' and the review budget is spent' : ''}, so do not re-read or re-fold already-consumed comments, and report roundsSpent: 0. The exemption covers the verdict and the answers only.\n`
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

// Did this wake's fold REVISE the objective? If so, the approval scanned at the top of this wake is
// already stale: the fold pushes to the epic branch, which moves the head the approving review was on,
// and the documented rule is that a push after approval re-opens the gate. The next wake's scan
// re-locks correctly — but the gates emitted BELOW, in this wake, were computed from the pre-fold value,
// so a child spec approval or a merge would be invited against an objective nobody has signed off. Those
// approvals are durable (mirrored to a label), so accepting one releases implementation with no second
// alignment gate — the exact defect already fixed for the unapproved case, in its other direction.
//
// `heldForFold` does not cover this: it defers WORK, and only when there is work to defer. A wake whose
// children are all merely awaiting a human gate holds nothing and still emits those gates.
// ANY fold that returned. Keying on `folded` or a non-zero round count left the hole that mattered most:
// a verdict fold and an answer fold are explicitly TOLD to report `roundsSpent: 0`, and `folded` was
// optional — so the two folds most certain to write the epic-spec (recording a settled claim, recording a
// human decision) could report neither signal and the guard read "nothing changed". The fold is only
// dispatched when there is something to fold, so a fold that came back wrote. Withholding one wake's
// child gates on a fold that genuinely changed nothing costs a wake; getting it wrong invites approval of
// a superseded objective, and that approval is durable.
const epicRevisedThisWake = !!epicFold
// The head recorded for the next wake is the one the gate scout saw, which the fold has now moved. Marking
// it unconfirmed is what stops a dead scout on the next wake from reading the durable approval as good.
if (epicRevisedThisWake) headUnconfirmed = true
if (epicRevisedThisWake) {
  log(
    `The epic-spec was revised this wake, so its approval no longer sits on the current head — withholding child spec-approval and merge gates until the next wake re-scans the folded objective.`,
  )
}

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
// Durable, for the same reason `unsettled` is: a question surfaced once and forgotten is a decision
// lost. The coordinator drops an entry when it records the answer.
// An answer is only spent once a fold RETURNED to record it — the same rule verdicts get, and for the
// same reason: a dead `epic-agent` folded nothing, so dropping the answer would leave the question
// removed and the spec unchanged, which is worse than either alone.
const answeredThisWake = new Set(epicFold ? (epicAnswersToFold || []).map((a) => a.question) : [])
if (answeredThisWake.size) {
  log(`Folded ${answeredThisWake.size} answered question(s) into the epic-spec; clearing them from the epic's open list.`)
}

const epicOpenQuestions = [...(epic.openQuestions || [])].filter((q) => !answeredThisWake.has(q))
for (const q of (epicFold && epicFold.openQuestions) || []) {
  if (!epicOpenQuestions.includes(q)) epicOpenQuestions.push(q)
}

// Same removal for an INCONCLUSIVE claim the human has now decided: `unsettled` entries are questions
// too, keyed by their claim text, and they were subject to the identical drop-without-applying gap.
const epicUnsettled = [...(epic.unsettled || [])].filter((u) => !answeredThisWake.has(u.claim))
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
  //
  // And the same `awaitingHumanDecision` withholding. This filter was independent of parking — a note
  // in this comment said so without drawing the conclusion — so a spec-review worker that escalated an
  // architectural fork parked the row and the coordinator still invited approval of that spec. Approval
  // releases implementation, so the human would be signing off an artifact whose open question is
  // unanswered and whose answer changes it. The question is surfaced in `blockers`; the gate appears
  // once it has been answered and folded, which is the only order that means anything.
  ...(!epicApproved || epicRevisedThisWake
    ? []
    : issues
        // `cursorUsable` for the same reason the merge gates have it, one gate kind over: a scan reporting
        // spec-review activity it cannot timestamp makes `pendingAction` refuse the review batch, and
        // approval chains STRAIGHT into implementation — so the human would sign off an artifact whose
        // newly reported feedback nobody has triaged, and it would be demoted to implementer notes
        // rather than weighed for whether it changes the spec. Adding the guard to merge gates alone was
        // the same one-sided application this file keeps producing.
        .filter((r) => r.phase === 'AWAITING_SPEC_APPROVAL' && !r.specApproved && !r.linearTerminal && !awaitingHumanDecision(r))
        .filter((r) => !(r.newSpecReviewEvents && !cursorUsable(r)))
        // ...and not while an answered decision is still unapplied: approval chains straight into
        // implementation, so signing off here locks in an artifact the human's own decision has not
        // reached yet.
        .filter((r) => !(r.blockerResolutions || []).length)
        .map((r) => ({
          kind: 'spec-approval',
          issueId: r.id,
          pr: r.specPr,
          settlingInFlight: contestedClaimFor(r.id),
        }))),
  // A child the human closed or dropped must not keep asking them to merge it.
  // A merge gate is only actionable with a PR NUMBER, so it is emitted per HANDLE, not per row.
  // A multi-PR row has no `implPr` at all — one aggregate gate for it carried `pr: null`, which the
  // coordinator cannot surface, so the DAG stopped at its first merge-ready slice.
  // `epicApproved` too, not just the revision guard. The objective gate holds the child RAMP — and a
  // merge is the terminal step of that ramp, so letting work land while the gate is closed is the one
  // outcome the gate cannot undo. (Only the spec-approval gate had this condition; the merge gate is the
  // more consequential of the two to miss.) Deliberately not a dead end: the human is shown the
  // epic-objective gate in the same list, and approving it releases these on the next wake.
  ...(!epicApproved || epicRevisedThisWake ? [] : issues)
    // `pendingAction` parks a row carrying an unresolved decision or an open prerequisite, but the
    // merge gate is independent of it — so the human was still told to merge work whose blocker they
    // had not answered, or whose dependency had not landed. Parking has to mean parked everywhere.
    // ...and the same for activity nobody can consume. A scan reporting `newPrEvents` with no timestamp
    // makes `pendingAction` refuse the feedback worker — the cursor cannot advance, so handling it would
    // re-handle it every wake — but the merge gate was independent of that too. The human merged, the row
    // went terminal, and the feedback that scan just reported was never handled by anyone. Withholding
    // here is the whole row's gates, which is deliberate: the same unreadable activity applies to the
    // sub-PR and repair handles, and the next scan with a timestamp releases all of them together.
    .filter((r) => !r.linearTerminal && !awaitingHumanDecision(r) && !(r.blockedBy && r.blockedBy.length))
    .filter((r) => !(r.newPrEvents && !cursorUsable(r)))

    .flatMap((r) => {
      const gates = []
      // Single-PR: the row's own impl PR.
      // `blockerResolutions` empty too: an ANSWERED decision that has not been applied yet withholds this
      // gate, where `awaitingHumanDecision` above covers only the UNanswered case. Deliberately on the
      // row-level gate rather than the whole row — the per-slice gates below carry their own precise
      // version, and a blanket row filter withheld a sibling slice's gate over a decision that had
      // nothing to do with it.
      if (r.readyToMerge && r.implPr && !(r.blockerResolutions || []).length) {
        gates.push({ kind: 'merge', issueId: r.id, pr: r.implPr })
      }
      // Multi-PR: each sub-PR the scan reported green, named so the human knows which slice.
      // Bound through `subPrScanBinding` — the SAME reader the durable fold uses. This was the second
      // consumer of `subPrStates` and it stayed positional when the fold was converted, so a scan that
      // answered every handle in its own order was folded correctly and then produced no merge gate:
      // the green slice was never offered, and a scout that consistently orders that way parks the DAG
      // for good. Two readers of one array is how the first version of this bug happened; leaving one
      // of them behind is how it came back.
      const gateBinding = subPrScanBinding(r.subPrs, r.subPrStates)
      for (const s of r.subPrs || []) {
        const live = gateBinding ? gateBinding.byId.get(s.id) : null
        // A green dependent whose `stackedOn` still names an unmerged prerequisite must NOT be
        // offered for merge: its base is that branch, so merging lands it into the prerequisite (or
        // makes the prerequisite's PR carry both slices), destroying the isolation the DAG exists
        // for and pre-empting the rebase `classify` still has to schedule.
        // ...and not while a human decision for THIS slice is still waiting to be applied. The answer
        // is delivered by a `resume` worker inside `issue-multi-pr`; until that has run, the PR is an
        // implementation that ignores the decision the human was asked for, and merging it is worse
        // than the stall clearing the blocker early was meant to fix.
        const answerPending = (r.blockerResolutions || []).some((x) => !x.for || x.for === s.id)
        if (live && live.readyToMerge && !live.merged && s.pr && !s.stackedOn && !answerPending) {
          gates.push({ kind: 'merge', issueId: r.id, pr: s.pr, subPr: s.id })
        }
      }
      // And the assembled-goal repair PR, which is neither of those — and which needs the SAME answer
      // guard as the slices above, for the same reason. `assembledGoal.fixPr` lives outside `subPrs`, so
      // the per-slice `answerPending` check never covered it: a decision escalated from feedback on an
      // open repair PR would clear, the assemble machine would report AWAITING_FIX with nothing to
      // dispatch, and the human would be invited to merge a repair that ignores their own answer.
      const repairAnswerPending = (r.blockerResolutions || []).some(
        (x) => !x.for || x.for === (r.assembledGoal || {}).owningSubPr,
      )
      if (r.assembledGoal && r.assembledGoal.fixPr && !r.assembledGoal.fixMerged && r.repairReadyToMerge && !repairAnswerPending) {
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
    // Same rule as `epicApproved` above: a live scan decides, but a scan with no head is not a
    // usable observation, so it neither grants nor revokes — the durable value stands.
    approved: gateUsable ? !!gate.approved : !!epic.approved,
    // ...and the fact that it could not be confirmed is persisted WITH it, or the next wake's
    // dead-scout fallback reads the durable approval as good and releases work this wake refused to.
    // Clearing path: any scan that returns a head. (The coordinator persists this verbatim.)
    headUnconfirmed,
    // Requested note routing that DIDN'T return leaves the ordinary feedback unrouted, so the
    // cursor must not move — otherwise it is consumed permanently. (Invariant 2.)
    // Same guard the issue rows get: activity reported with NO timestamp gives the cursor nothing to
    // move to, so the batch would be rediscovered and re-charged every wake until the budget
    // converged. The observation is the scan's failure, so the cursor holds and the flag stays live.
    ...((epicCursorMovable && (routeConvergedEpicFeedback ? !!epicNotes : !!epicFold)) || !newEpicReviewEvents
      ? {
          lastSeenActivityAt: (gate && gate.latestActivityAt) || epic.lastSeenActivityAt || null,
          lastSeenSha: (gate && gate.headSha) || epic.lastSeenSha || null,
        }
      : { lastSeenActivityAt: epic.lastSeenActivityAt || null, lastSeenSha: epic.lastSeenSha || null }),
    // Same rule as an issue's: add only the rounds the folder reports spending.
    reviewRounds: epicReviewRounds + (epicFold ? epicFold.roundsSpent || 0 : 0),
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
    // Same contract: cross-cutting questions the fold raised, carried until answered.
    openQuestions: epicOpenQuestions,
    // Answers awaiting a fold. Cleared only once one RETURNED and applied them — a dead fold keeps
    // them, exactly as it keeps a verdict, so an infrastructure failure can't swallow a human decision.
    answers: epicFold ? [] : epicAnswersToFold || [],
  },
  epicFold: epicFold ? { folded: epicFold.folded, fanOut: epicFold.fanOut || [] } : null,
  // Converged epic-PR feedback, read but not folded — the coordinator routes each note to the
  // issues it names as an implementer note. Empty/absent when nothing needed routing.
  epicNotes: epicNotes ? epicNotes.notes || [] : null,
  issues,
  gates,
  blockers: [
    ...issues.filter((r) => r.blocker).map((r) => ({ issueId: r.id, blocker: r.blocker })),
    ...epicUnsettled.map((u) => ({ issueId: epic.issueId, blocker: `POC returned INCONCLUSIVE — needs a human decision: ${u.claim}`, evidence: u.evidence, threads: u.threads })),
    ...epicOpenQuestions.map((q) => ({ issueId: epic.issueId, blocker: `Epic-spec open question — needs a human: ${q}` })),
  ],
  // The evidence behind every row-level INCONCLUSIVE, so the coordinator can put the question with
  // what the POC found rather than just the claim text.
  unsettled: issues.filter((r) => (r.unsettled || []).length).map((r) => ({ issueId: r.id, unsettled: r.unsettled })),
  blocked: plan.blocked.map((r) => ({ issueId: r.id, blockedBy: r.blockedBy })),
  held: plan.held.map((i) => i.row.id),
  // Work deferred ONE wake for the fold that just ran. It is not waiting on an external event, so
  // without this the coordinator ends its turn and the promised next wake depends on unrelated PR
  // activity or the heartbeat — a wait with no path out, which is the thing the hold was not
  // supposed to introduce. Non-empty means: run another wake NOW, against the folded objective.
  heldForFold: plan.heldForFold.map((i) => ({ issueId: i.row.id, action: i.action })),
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
