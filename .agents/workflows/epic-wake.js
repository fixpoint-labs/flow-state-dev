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

/** Auto-handled PR-feedback rounds allowed on one issue before the human is asked. */
const PR_FEEDBACK_CAP = 12

/**
 * Has an issue's PR-feedback loop hit its cap?
 * → orchestration.md § "PR feedback: the round cap" (canonical).
 *
 * Not a convergence budget — a code PR's threads DO gate its merge, so there is no
 * "converged, carry the rest as notes" exit the way there is for a spec. This is a LOOP
 * DETECTOR: twelve is well past a normal review (two to four rounds), so reaching it is
 * evidence something structural is wrong and the human should say what to do.
 *
 * Cleared by RESETTING the counter, which the coordinator does when it records the human's
 * answer — deliberately the same shape as the spec budget's reset, and there is no separate
 * "cleared" flag to get out of step with the count.
 */
function atPrFeedbackCap(spent = 0) {
  return spent >= PR_FEEDBACK_CAP
}

/**
 * Is this row's feedback loop capped AND is there still work for the human to decide about?
 *
 * A DIFFERENT question from `atPrFeedbackCap`, which is the pure budget test ("may we spend another
 * round?"). This is the human-facing one — "is a question owed about this row?" — and it is what the
 * gates, the log line and the surfaced blocker all have to agree on. Composed from the budget test
 * rather than restating it, so the threshold lives in exactly one place.
 *
 * The liveness clause is the whole difference: a row the human cancelled, or one whose PR merged out
 * from under the loop, keeps its phase and its count, and asking whether to re-examine the approach of
 * work that no longer exists is a question nothing can answer. It held `mayWrap` open forever, and the
 * log claimed a row was "surfaced for a decision" that the blockers list had already excluded — two
 * predicates over the same state disagreeing, which is the failure this file keeps producing.
 */
function cappedAwaitingDirection(row) {
  return (
    row.phase === 'PR_FEEDBACK' && atPrFeedbackCap(row.prFeedbackRounds) && !row.linearTerminal && !row.merged
  )
}

/**
 * The category label that opens the direct route. Anchored, so "Debug" is not a bug — the only
 * path to implementation with no human sign-off in front of it should not turn on a substring.
 */
const BUG_CATEGORY = /^bugs?$/i

/**
 * Which route an issue takes into implementation.
 * → orchestration.md § "Which issues get a spec" (canonical).
 *
 * A **bug** takes the `direct` route: no spec, no spec PR, and NO spec-approval gate — its only
 * human gate is the merge. Everything else takes the `spec` route and is unchanged.
 *
 * Three things override the label, and all three live HERE rather than being re-tested at each
 * consumer — a route decided in two places is a row that is `direct` to the dispatcher and `spec`
 * to the gate filter, which is either ungated code or a gate nobody can satisfy:
 *
 * 1. **A spec PR exists.** Someone specced it deliberately; honour that rather than stranding a
 *    reviewed document. This also covers the bug that was already mid-spec when it got relabelled.
 * 2. **A worker promoted it** (`specRequired`) — it found no reproduction, or found the "bug" is
 *    really a feature. Sticky, because the label still says Bug and the next refresh would
 *    otherwise re-derive `direct` and undo the promotion every wake.
 * 3. **The scout DIED.** No observation at all, so the carried route stands (defaulting to `spec`).
 *    This is the only case that carries a route forward, and the distinction from case 4 is the
 *    whole point: "we did not look" is not the same answer as "we looked and there is no label."
 * 4. **Observed with NO category.** Fails closed to `spec` — never to the carried route. The scan
 *    prompt asks for the label verbatim and `null` only when the issue genuinely carries none, so
 *    a null is evidence the issue is uncategorized, not evidence it is still whatever it was.
 *    Preserving `direct` here would leave a row ungated after its Bug label was *removed* — the
 *    one mutation a human makes precisely to re-gate it — and it contradicts the contract that
 *    every refresh re-routes from the current category. Failing closed costs one unnecessary
 *    document; failing open ships code through the one route with no gate in front of it.
 *
 * @param row       the carried record (its `route` is the fallback, never the authority)
 * @param li        this wake's Linear read for the issue
 * @param observed  did the Linear scan actually report this issue?
 * @param specPr    the RESOLVED spec PR handle (carried or freshly scanned), not `row.specPr`
 */
function routeFor(row, li, observed, specPr) {
  if (specPr) return 'spec'
  if (row.specRequired) return 'spec'
  if (!observed) return row.route || 'spec'
  const category = ((li && li.category) || '').trim()
  if (!category) return 'spec'
  return BUG_CATEGORY.test(category) ? 'direct' : 'spec'
}

/** A pure field read, deliberately: `routeFor` is the only thing that decides this. */
function isDirectRoute(row) {
  return row.route === 'direct'
}

/**
 * The next bounded action for one issue, or null if it is genuinely waiting on something
 * external. `why` is for the log line — a dispatch the user can't explain is drift.
 */
/**
 * Is the epic's cross-spec coherence pass still owed?
 *
 * `epic-lifecycle` runs ONE coherence pass over the whole spec set before any of it is built — an epic's
 * specs are authored in isolation, so each can be locally excellent while the set claims the same surface
 * twice or contradicts itself. Moving the advance decision into this script left that gate behind entirely:
 * every spec chained straight from approval into implementation, so conflicts were found (if at all) after
 * the code existed, which is the expensive half of the order the gate exists to prevent.
 *
 * Set by the coordinator, which owns the gate: it needs the user's approval to run the pass at all, and only
 * it can dispatch `cross-spec-review`. The script's job is to keep approved rows parked until it clears.
 */
let crossSpecHold = false

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
          ? crossSpecHold
            ? null
            : cursorUsable(row)
            ? { action: 'implement', why: 'spec approved on current head, with outstanding spec-PR feedback to carry as implementer notes' }
            : // The approval is real, but the batch riding with it cannot be recorded as handled — and this
              // is the ONLY pass that reads spec-PR feedback, so dispatching would carry it once and then
              // rediscover it on every later timestamp-less scan, re-handling and re-replying each time.
              // The same hold the spec-review and CI paths already take.
              null
          : crossSpecHold
          ? null
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
      // A DIRECT-route row (a bug) reaches implementation with no spec and no approval, by design
      // — this is the phase it enters at. Both guards below are about the spec-approval gate, and
      // neither has anything to hold: there is no spec to approve, and no spec to be incoherent
      // with the rest of the set. Applying them anyway parks every bug in the epic forever, on a
      // gate the coordinator is explicitly told never to surface for these rows.
      if (isDirectRoute(row)) return { action: 'implement', why: 'bug — direct route, no spec required' }
      // The phase NAME asserts approval; only `specApproved` establishes it, and the schema validates
      // the two independently — so a scout that derives the phase wrongly would dispatch
      // implementation on a spec no human ever approved. This is the one gate that must never be
      // bypassable, so the phase is not allowed to be the thing that carries it.
      if (!row.specApproved) return null
      if (crossSpecHold) return null
      return { action: 'implement', why: 'spec approved, implementation not started' }

    case 'PR_FEEDBACK': {
      // The round cap. Past it, no feedback round is dispatched at all: the batch stays
      // unconsumed (the cursor never advances, exactly as it doesn't for a converged spec) and
      // `epicBlockers` surfaces the question every wake until the human answers it and the
      // coordinator resets the counter. → orchestration.md § "PR feedback: the round cap".
      //
      // Scoped to the three feedback dispatches, NOT to the whole phase: a multi-PR DAG step
      // below is not a feedback round, and parking it would stall the issue's remaining slices
      // for a reason that has nothing to do with the review loop.
      const capped = atPrFeedbackCap(row.prFeedbackRounds)
      // Same guard: a CI failure needs no timestamp (it is not comment activity), but reported PR
      // activity without one would be re-applied every wake.
      // CI is actionable on its own — but NOT while the same scan reports review activity it cannot
      // timestamp. `pr-feedback` consumes the review cursor, and an unreadable cursor cannot advance, so
      // the dispatch would re-deliver that identical batch every wake and the worker would re-post its
      // replies each time. The cost is a CI fix waiting a wake for a scan that timestamps its activity;
      // the alternative is unbounded duplicate replies on someone's PR, which is not recoverable by
      // waiting. A CI failure with no unreadable activity is untouched.
      // EITHER flag unreadable holds the dispatch. This named only `newPrEvents`; once late spec-PR activity
      // started routing through the same worker and the same shared cursor, an unreadable spec batch would be
      // re-delivered every wake alongside the CI work, re-posting its replies each time.
      if (!capped && row.ciFailed && !((row.newPrEvents || row.newSpecReviewEvents) && !cursorUsable(row))) {
        return { action: 'pr-feedback', why: 'CI is failing' }
      }
      if (!capped && row.newPrEvents && cursorUsable(row)) return { action: 'pr-feedback', why: 'unhandled PR activity' }
      // Late SPEC-PR feedback belongs here too. Comments can land on a retained or closed spec PR after the
      // row has moved on, and this branch reacted only to impl-PR activity and CI: with no CI failure the
      // row could take a merge gate over an unread comment, and with one the feedback worker consumed the
      // shared cursor and cleared BOTH flags without ever being told to read it. Same handling the
      // approval batch gets — implementer notes, not a spec round.
      if (!capped && row.newSpecReviewEvents && cursorUsable(row)) return { action: 'pr-feedback', why: 'unhandled spec-PR feedback to carry as implementer notes' }
      // A multi-PR row's DAG advances on merges and on its own deferred work, neither of which is
      // "PR activity". Without this the issue stalls the moment a merge unblocks its next slice.
      if (multiPrHasWork(row)) return { action: 'implement', why: 'multi-PR DAG has work: a ready slice, a deferred one, or the assembled goal' }
      return null
    }

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
 * One claim argued on two issues is ONE settlement fanned to both — WHEN the two requests spell it the
 * same way. The key normalizes case and whitespace and nothing more, so genuinely different wording
 * produces two POCs and two evidence replies. Recorded rather than papered over: closing that gap needs a
 * durable claim identity supplied by the requester, or a canonicalization pass, and neither is something a
 * mechanical key can fake. The framings of requests that DO collide are merged (see below), so the one
 * settlement they share tests every path it answers for.
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
 * How many rounds this dispatch spent against a budget — the spec-review budget and the PR-feedback
 * cap alike, because both charge by the same three rules and a drift between them is a budget that
 * silently stops bounding anything.
 *
 * 1. A worker that escalated a `blocker` **didn't finish the round**, any more than it finished
 *    reading the batch — the cursor already holds for it, and the counter has to agree. Charged
 *    anyway, one round becomes two, and after the human clears the blocker the retained batch reads
 *    as CONVERGED and is never resumed: the guard silently eats the work it was protecting.
 * 2. An **unreported round is charged one.** The field is optional, so charging zero would let every
 *    batch consume its feedback, advance the cursor and add nothing — the budget never reached, which
 *    is the exact unbounded sequence it exists to prevent.
 * 3. A worker that genuinely spent none says so **explicitly with 0**, and that is honoured: a spec
 *    batch of pure factual corrections, a feedback batch of pure acknowledgements.
 *
 * @param finished  did the worker return WITHOUT escalating a blocker?
 * @param isRound   was this dispatch the kind that spends the budget at all?
 * @param reported  the count the worker reported, or undefined if it reported none
 */
function chargeRound(finished, isRound, reported) {
  // `isRound` is decided by the ACTION, and it is the whole authority on whether this dispatch can
  // spend budget — so a report from any other action is ignored rather than added. `WORKER_SCHEMA`
  // permits both count fields on every action (one schema, all actions), and no prompt asks for them
  // outside a review or feedback dispatch; falling through to the reported value let a DAG build or a
  // decision application charge rounds nobody dispatched, which walks an issue to a cap that
  // orchestration.md says only feedback handling can reach.
  if (!finished || !isRound) return 0
  if (reported === undefined) return 1
  // A round is BOOLEAN — one dispatch is one pass over the outstanding batch — so the report says
  // whether this dispatch was one, and can never size it. `number` in the schema accepted anything an
  // agent emitted and this added it verbatim: a feedback worker that touched three sub-PR handles and
  // reported `3` (one pass, three handles — a reading the multi-PR prompt invites) parks the issue at
  // the cap after four dispatches, and a negative would walk the counter BACKWARD, past a cap that is
  // supposed to be reachable and against the monotonicity the reset rule depends on.
  return reported > 0 ? 1 : 0
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
 *
 * The PR-feedback cap belongs here for the reason this predicate exists at all. It parks a row without
 * writing a `blocker` — the question is derived from the counter — so a gate filter testing only the
 * stored field saw nothing: a capped row whose scan reported `readyToMerge` was offered the merge gate
 * and the "we stopped, is the approach wrong?" question in the SAME wake. That invites the one
 * irreversible action while telling the human we have stopped working, and "merge as-is" is one of the
 * answers they may give — so it must come back as their decision, which resets the counter and releases
 * the gate on the next wake, not as an invitation issued before they have answered.
 */
function awaitingHumanDecision(row) {
  return !!row.blocker || cappedAwaitingDirection(row)
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
  // A direct-route row is UNAPPROVED BY CONSTRUCTION — a bug has no spec to approve. Without this
  // exemption the correction fires on every bug sitting at NEEDS_IMPLEMENTATION and knocks it back
  // to NEEDS_SPEC, where `pendingAction` dispatches `issue-spec`: the exact document the route
  // exists to skip, authored on a loop, since the next refresh re-derives `direct` and does it again.
  if (isDirectRoute(row)) return null
  if (row.phase !== 'NEEDS_IMPLEMENTATION' || row.specApproved) return null
  return row.specPr ? 'AWAITING_SPEC_APPROVAL' : 'NEEDS_SPEC'
}


/** Phases that exist only before the spec is signed off. */
const PRE_APPROVAL_PHASES = new Set(['NEEDS_SPEC', 'AWAITING_SPEC_APPROVAL'])
/** Phases that assert the spec IS signed off. */
const POST_SPEC_PHASES = new Set(['NEEDS_IMPLEMENTATION', 'PR_FEEDBACK', 'DONE'])

/**
 * A direct-route row's entry phase is NEEDS_IMPLEMENTATION, not NEEDS_SPEC.
 *
 * Nothing sets it there directly, and that is deliberate — a row is created (or discovered) before
 * anything has read its category, so the route is derived on the refresh that first sees the Linear
 * label and the phase is corrected here, in the same pass. That covers all three ways a row can
 * arrive at a spec phase it does not belong in: a newly discovered bug entering the table, a carried
 * row created before this rule existed, and an issue relabelled Bug mid-epic.
 *
 * Only the two PRE-approval phases are corrected. A direct row that has already reached
 * PR_FEEDBACK or DONE is exactly where it should be.
 */
function directRoutePhase(row) {
  if (!isDirectRoute(row) || !PRE_APPROVAL_PHASES.has(row.phase)) return null
  return 'NEEDS_IMPLEMENTATION'
}

/**
 * Does this worker-reported phase jump ACROSS the approval gate?
 *
 * `approvalGatedPhase` corrects a row that is SITTING at `NEEDS_IMPLEMENTATION` unapproved, which only
 * catches the one intermediate phase. A worker reporting `PR_FEEDBACK` with an `implPr` straight from
 * `NEEDS_SPEC` skipped past it entirely and reached a merge gate with no human sign-off — the one gate
 * this file says everywhere must never be bypassable, bypassed by a self-report.
 *
 * Deliberately keyed on the CARRIED phase, not on `specApproved` alone. `specApproved` is re-derived
 * from a live scan every wake, and once implementation starts the spec PR is closed, so a legitimately
 * implementing row reports `false` forever — gating every post-spec phase on it would knock all real
 * work back to `NEEDS_SPEC`. What is illegitimate is the TRANSITION, and only this wake can see it.
 */
/**
 * The phase a refresh scan is allowed to move a row to.
 *
 * A scout reports FACTS — which PRs exist, what Linear says — and both directions across the approval gate
 * are conclusions rather than facts. Forward is the bypass (`PR_FEEDBACK` with an impl handle on a row
 * still awaiting approval, reaching a merge gate with no sign-off). BACKWARD is the mirror, and it costs
 * duplicate work rather than a bypass: a carried `PR_FEEDBACK` row reported as `NEEDS_SPEC` while its
 * implementation PR is open makes the next wake dispatch `issue-spec` and open a second spec PR for work
 * already under review. Re-gating a row is a decision, and no scan gets to make it.
 */
function scoutPhaseFor(row, reportedPhase, scanApproved, route) {
  if (!reportedPhase) return row.phase
  // `route` is passed in for the same reason `scanApproved` is: both are derived from THIS wake's
  // scan, and the carried row does not have them yet. Reading `row.route` here instead would leave
  // the gate exemption unreachable on the first wake that classifies an issue as a bug — which is
  // exactly the wake a bug with an already-open PR needs it, since refusing that report as a
  // "bypass" sends the row back to `implement` and opens a second PR for the same fix.
  if (jumpsTheApprovalGate({ ...row, specApproved: scanApproved, route }, reportedPhase)) return row.phase
  const regresses = POST_SPEC_PHASES.has(row.phase) && PRE_APPROVAL_PHASES.has(reportedPhase)
  if (regresses && (row.implPr || (row.subPrs || []).length)) return row.phase
  return reportedPhase
}

function jumpsTheApprovalGate(row, reportedPhase) {
  // There is no gate to jump on the direct route. A bug carried at NEEDS_SPEC (it has not been
  // corrected yet — see `directRoutePhase`) whose worker legitimately opened an impl PR would
  // otherwise have that report refused as a bypass, and the row would report progress it made and
  // then be told it did not make it.
  if (isDirectRoute(row)) return false
  if (!reportedPhase || row.specApproved) return false
  return PRE_APPROVAL_PHASES.has(row.phase) && POST_SPEC_PHASES.has(reportedPhase)
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
  const carriedStatus = new Map((row.subPrs || []).map((sp) => [sp.id, sp.status]))
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
      // Spent only where something OBSERVABLE proves delivery. `pending || blocker` was not enough: the
      // epic refresh clears an answered slice's nested blocker before dispatch, so a resume that comes
      // back `failed` leaves the slice `open` with nothing left to preserve — each layer expected the
      // other to hold the blocker, and the answer was dropped with the PR unchanged and merge-eligible.
      //
      // Three things prove it. `answerApplied` is the nested workflow SAYING SO, which is the only signal
      // that can distinguish a successful `open → open` resume from a failed one — inferring it from status
      // meant either dropping the answer or re-dispatching the same resume forever, and the slice could
      // neither finish nor stop reapplying the decision. The other two are structural: the slice MERGED
      // (the decision went in with the code), or it moved `pending → open` this wake (the build that opened
      // the PR is the delivery).
      if (sp.answerApplied) return false
      if (sp.status === 'merged') return false
      if (carriedStatus.get(sp.id) === 'pending' && sp.status === 'open') return false
      return true
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
  // An `apply-decision` that RETURNED spent the queued answers, and those answers are what an unsettled
  // record was waiting for — so the record goes with them. Carried unconditionally, the top-level
  // `unsettled` output kept advertising an already-decided claim on every later wake, so orchestration
  // state and the user-facing disclosure were permanently stale.
  //
  // Coarse on purpose: the row's blocker surfaced all of its unsettled claims as ONE question and the
  // human answered that question, so they clear together. A later INCONCLUSIVE verdict re-populates the
  // list, which is why losing an unanswered one here is not a risk worth extra bookkeeping.
  // No `worker &&` guard: this is only reached with one, since the `if (!worker)` return above owns the
  // dead case — and there `...row` preserves the records, which is what a dead worker should do.
  const decisionApplied = action === 'apply-decision'
  const unsettledRecords = [
    ...(decisionApplied ? [] : row.unsettled || []),
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

  // Both budgets charge by the SAME three rules — see `chargeRound`. They were written out twice,
  // identical but for the action string and the field, which made "the same rules" a claim in a
  // comment rather than something the code enforced.
  const roundsSpent = chargeRound(workerFinished, action === 'spec-review', worker.specReviewRoundsSpent)
  const prRoundsSpent = chargeRound(workerFinished, action === 'pr-feedback', worker.prFeedbackRoundsSpent)

  const next = {
    ...row,
    ...cursor,
    ...consumedFlags,
    phase: jumpsTheApprovalGate(row, worker.phase) ? row.phase : worker.phase || row.phase,
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
    // The PR-feedback cap's counter. Only the COORDINATOR resets it — when it records the
    // human's answer at the cap — so nothing here ever decreases it.
    prFeedbackRounds: (row.prFeedbackRounds || 0) + prRoundsSpent,
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
    // A direct-route worker refusing to build (no reproduction, or not really a bug) promotes its
    // row back to the spec route. STICKY, and that is the whole reason it is a persisted field
    // rather than an immediate phase change: the Linear label still says Bug, so the next refresh
    // would re-derive `direct` and undo the promotion — every wake, forever. `routeFor` reads it
    // first for exactly that reason. Never cleared here; only a human relabelling the issue, or a
    // spec PR actually existing, ends it.
    specRequired: worker.specRequired || row.specRequired || null,
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
    subPrs: mergedSubPrs,
    // Set EXPLICITLY when clearing: `...row` above already carries the old list, so merely omitting the
    // override left the stale records in place.
    unsettled: unsettledRecords,
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
function foldMultiPrScan(row, fresh, refreshedLive) {
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
  // A CLOSED-UNMERGED handle is a human decision, not a state the wake can resolve: reopen the PR,
  // re-implement the slice, or drop it. Left unreported it idled the row forever; reported and ignored it
  // would idle just the same, so it parks the row with the question named.
  const closedHandles = [
    ...(fresh.closedUnmerged && row.implPr ? [`impl PR #${row.implPr}`] : []),
    // The repair handle needed this too: closed unmerged, `assembleState` stays at AWAITING_FIX,
    // `multiPrHasWork` dispatches nothing, and no merge gate appears — the row idles indefinitely.
    ...(fresh.repairClosedUnmerged && row.assembledGoal && row.assembledGoal.fixPr ? [`repair PR #${row.assembledGoal.fixPr}`] : []),
    ...(binding
      ? (out.subPrs || []).filter((sp) => (binding.byId.get(sp.id) || {}).closedUnmerged).map((sp) => `sub-PR ${sp.id}${sp.pr ? ` (#${sp.pr})` : ''}`)
      : []),
  ]
  // ...and NOT while the answer to it is already queued. A closed PR stays closed, so every later scan
  // reports it again: the coordinator would clear the blocker, record the human's reopen/reimplement/drop
  // decision, and this branch would recreate the blocker on the very next refresh — parking the row before
  // the answer could reach any worker. The blocker I added for this was therefore unresolvable by
  // construction, which is worse than the idling it replaced.
  if (closedHandles.length && !out.blocker && !row.blocker && !(row.blockerResolutions || []).length) {
    // The options named here are the ones the machinery can actually carry out. "Drop" was in this text
    // and is NOT one of them: removing a slice is a PR-plan edit, and promising it produced a decision the
    // resume path could only refuse or re-escalate. Reopening is the human's own action on GitHub — the
    // next scan simply stops reporting the handle closed — so the only answer this wake delivers is a
    // rebuild, and that is what the text asks for.
    out.blocker =
      `Closed without merging: ${closedHandles.join(', ')}. Needs a human decision — either reopen the PR on GitHub (no answer needed here, the next scan picks it up), ` +
      `or answer to have the slice REBUILT from scratch. Dropping it means editing the issue's PR plan, which is not something this wake can do.`
    // TAGGED, because this blocker is a scan OBSERVATION and not a durable escalation. Reopening the PR is
    // the recovery the text above advertises, and nothing was clearing the blocker when the scan stopped
    // reporting the handle closed — so the advertised path parked the row forever. The tag is what lets
    // the next wake tell "the human reopened it" from "a worker escalated something".
    out.closedBlocker = true
  } else if (row.closedBlocker && !closedHandles.length && refreshedLive && cursorUsable(row)) {
    // The handle is open again (or merged): the observation that produced this blocker is gone, so the
    // blocker goes with it. Same rule every other scan-derived field in this function follows.
    //
    // But only on a LIVE, COMPLETE scan. A dead scout leaves `fresh` empty and a partial multi-PR scan can
    // omit the handle, and in both cases "no closed handle reported" is indistinguishable from "reopened" —
    // so clearing on absence released the row on the strength of an observation nobody made, and dispatched
    // work against a handle that is still dead. Absence of evidence is the one thing this file has learned
    // never to read as evidence.
    out.blocker = null
    out.blockerFor = null
    out.closedBlocker = false
  }

  // Which slices the scan saw CLOSED — and, once their answer is in hand, RESET HERE so the reset is in
  // the table the dispatch serializes. Doing it after the worker returned meant the worker was handed the
  // still-`open` slice, so the nested workflow classified it `resume` and was forbidden from opening a
  // replacement: a wasted wake before the rebuild could even start. The marker rides along so
  // `mergeSubPrs` can refuse a worker echoing the dead handle back to `open`, which is what undid the
  // reset when it lived here before.
  // DETECTION only. There is deliberately no automatic rebuild here any more: resetting the slice,
  // marking the dead handle, and refusing the worker's echo of it turned out to need a distinction the
  // merge boundary does not have — "the handle you were given" versus "the handle you just created" — and
  // each guard for one produced a defect in the other (the last one orphaned the replacement PR a rebuild
  // had legitimately opened). Detection was the stall fix and it stands; recovery is the human's, applied
  // by an ordinary worker that is told in its prompt which handle is closed.

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
    // `merged` is unassertable for a NEW slice too. The transition guard below cannot see one — there is
    // no `prev` to compare against — so a worker revising the PR plan could insert `{ id, status:
    // 'merged' }` and immediately satisfy `allMerged`: the issue reaches DONE with a slice that never had
    // a PR and never passed the human merge gate. Only the refresh scan observes a merge.
    // Scoped to `!prev` because that is the only case this decides: a CARRIED slice's status is already
    // owned by the transition guard immediately below, which reverts anything but pending → open.
    if (!prev && merged.status === 'merged') {
      log(`${r.id}: added as merged, which only the refresh scan can observe — entering it as pending.`)
      merged.status = 'pending'
    }
    if (prev && merged.status !== prev.status) {
      const workerOwns = prev.status === 'pending' && merged.status === 'open'
      if (!workerOwns) merged.status = prev.status
    }
    // `open` needs BOTH handles — for a CARRIED slice as much as a new one. This ran only for new slices,
    // which left the one transition a worker genuinely owns (pending → open) able to land a slice with no
    // PR and no branch: nothing for the scout to refresh, no merge gate able to name it, and no `classify`
    // action for an ordinary open node. Held at pending, the next wake simply builds it — which is what
    // the worker meant either way.
    if (merged.status === 'open' && !(merged.pr && merged.branch)) {
      log(`${r.id}: reported open with no PR/branch — holding it at pending so it gets built.`)
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
  // A DEAD scout confirms nothing, so it releases nothing. Comparing against the carried head accepted an
  // approval for H1 while a push had already created H2 that no scan had seen — the issue-level twin of the
  // epic-gate race, and the same fix: hold for this wake, and the next usable scan releases it. The
  // approval itself is untouched; only its power to release work this wake is.
  return false
}

/**
 * THE spec-approval decision. Every channel and every veto lives here, and nothing outside computes
 * approval from parts.
 *
 * Approval arrives three ways — an approving human comment/review on the current head, the
 * `spec approved` label, or an in-session go-ahead the coordinator recorded — and a human
 * `CHANGES_REQUESTED` vetoes all of them.
 *
 * It is one function because it was three expressions, and a rule added to a scattered OR has to be
 * remembered at every branch. It wasn't: the change-request veto was added to the comment/review and
 * label branches and missed on the in-session one, which let a spec enter implementation past a
 * change request. Review had caught the same shape one round earlier on a different branch. Composing
 * the channels in one place makes the next rule impossible to half-apply.
 */
function specApprovalFor(row, fresh, refreshedLive) {
  // A veto needs a live observation to be trusted. Without one there is nothing to veto WITH, and the
  // channels below already refuse to release on a dead scout.
  if (refreshedLive && fresh.humanChangesRequested) return false
  const byReview = refreshedLive && !!(fresh.specApproved && fresh.headSha)
  const byLabel = refreshedLive && !!fresh.specApprovedByLabel
  return byReview || byLabel || approvedInSessionFor(row, fresh, refreshedLive)
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
  required: ['approved', 'approvedByLabel', 'humanChangesRequested', 'newReviewEvents', 'headSha', 'latestActivityAt'],
  properties: {
    approved: { type: 'boolean', description: 'A human approving comment or a current-head APPROVED review by a non-author human' },
    approvedByLabel: {
      type: 'boolean',
      description:
        'The `epic approved` label is present on the PR. Presence alone — a label is standing state the owner can remove, so removal is the revocation and no staleness rule applies.',
    },
    humanChangesRequested: {
      type: 'boolean',
      description:
        "A human's LATEST review state on the epic PR is CHANGES_REQUESTED. Outranks the label, which the coordinator mirrors on approval and which therefore survives a later change request. Bots never count.",
    },
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
          // The ROUTE's input → orchestration.md § "Which issues get a spec". Deliberately NOT
          // required: an omission (or a null) keeps the carried route and otherwise defaults to
          // `spec`, which is the safe direction. Requiring it would make a scout that cannot read
          // labels fail the whole scan, which costs a wake of every issue rather than one document.
          category: {
            type: ['string', 'null'],
            description: 'The Linear category label (Bug / Feature / Enhancement / Improvement). "Bug" routes the issue straight to implementation with no spec.',
          },
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
  required: ['issueId', 'phase', 'specApproved', 'specApprovedByLabel', 'humanChangesRequested', 'newSpecReviewEvents', 'newPrEvents', 'readyToMerge', 'merged', 'ciFailed', 'headSha'],
  properties: {
    issueId: { type: 'string' },
    phase: { type: 'string', enum: LIFECYCLE_PHASES },
    // A PR CLOSED WITHOUT MERGING was unreportable: the scout reads PR metadata, but the only outcomes it
    // could express were merged / ready / not-ready. A single-PR row then sat in PR_FEEDBACK forever —
    // nothing merged, no activity, no action — and a sub-PR stayed durably `open`, which `classify()`
    // cannot advance either. Not required, since most scans have no closed handle to report; a `true`
    // parks the row on a human decision rather than idling it silently.
    closedUnmerged: {
      type: 'boolean',
      description: 'The row-level implementation PR was closed WITHOUT merging. For a slice use subPrStates[].closedUnmerged.',
    },
    specPr: { type: ['number', 'null'] },
    implPr: { type: ['number', 'null'] },
    specApproved: { type: 'boolean', description: 'Approving human comment/review on the CURRENT head — never a stale one' },
    specApprovedByLabel: {
      type: 'boolean',
      description:
        'The `spec approved` label is present on the spec PR. Presence alone — the owner signs off this way too, and a label is standing state whose removal is the revocation, so it does not expire on a push.',
    },
    humanChangesRequested: {
      type: 'boolean',
      description:
        "A human's LATEST review state on the spec PR is CHANGES_REQUESTED. Reported separately because it must outrank the label: the coordinator mirrors approvals to `spec approved`, so a stale mirror would otherwise carry an issue past a change request nobody addressed. Bots never count.",
    },
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
          /** This slice's PR was closed WITHOUT merging — durably `open` otherwise, which nothing advances. */
          closedUnmerged: { type: 'boolean' },
        },
      },
    },
    // The assembled-goal repair PR, which lives outside `subPrs` and whose merge is the only thing
    // that re-arms the end-to-end goal.
    repairMerged: { type: 'boolean' },
    repairReadyToMerge: { type: 'boolean' },
    /** The repair PR was closed WITHOUT merging — otherwise `AWAITING_FIX` idles with nothing to dispatch. */
    repairClosedUnmerged: { type: 'boolean' },
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
          answerApplied: {
            type: 'boolean',
            description:
              "Set by issue-multi-pr when a resume actually applied a queued human answer to this slice's existing PR. It is the only way to tell a successful open → open resume from a failed one, so the caller can spend the one-shot answer instead of guessing.",
          },
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
    specReviewRoundsSpent: {
      type: 'number',
      description: 'Did this dispatch spend a review round? 1 yes, 0 for a batch that was only factual corrections. Never more than 1 — one dispatch is one pass.',
    },
    prFeedbackRoundsSpent: {
      type: 'number',
      description:
        'Did this dispatch spend a PR-feedback round? 1 for a normal pass over the batch, 0 for a batch that was only acknowledgements and process chatter. Never more than 1, however many PR handles the pass touched. Omit and you are charged 1.',
    },
    specLevelFound: { type: 'boolean', description: 'Did this round surface a genuine spec-level finding? Authorizes the third round.' },
    // A direct-route (bug) worker promoting its row BACK to the spec route. The reason, not a
    // boolean: it is logged and it is what tells the human why a bug is suddenly being specced.
    // Sticky once set (see `routeFor`), because the Linear label still says Bug and the next
    // refresh would otherwise re-derive `direct` and undo the promotion on every wake.
    specRequired: {
      type: ['string', 'null'],
      description:
        'Set ONLY by a direct-route (bug) worker that refused to build: the issue has no reproduction and an ambiguous symptom, or it is not really a bug (the fix is a new capability or a contract change). One line saying which and why. A design decision found mid-diagnosis is NOT this — that ships with the fix and is surfaced on the PR.',
    },
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

// The Workflow tool delivers `args` as a JSON string at runtime, while `verify.mjs` passes
// an object. Normalize so the script reads the same either way — reading `args.x` off a
// string silently yields `undefined` for every field, which fails far from the cause.
const input = typeof args === 'string' ? JSON.parse(args) : (args || {})
const epic = input.epic
const rows = input.issues || []
// An explicit positive cap wins; anything else (absent, 0, junk) falls back to the default
// rather than silently becoming it.
const cap = Number.isFinite(input.cap) && input.cap > 0 ? input.cap : 3
const requests = input.settleRequests || []

phase('Refresh')

// Barrier, and justified: the epic gate holds EVERY issue, and the cap is a decision
// across the whole set — nothing can be dispatched before all rows are known.
const [gate, linear, ...prStates] = await parallel([
  () =>
    agent(
      `Scan epic PR #${epic.prNumber} in this repo for its objective sign-off. Report approved:true ONLY for a human approving comment, or a review whose LATEST state is APPROVED on the CURRENT head by a human who is not the PR author. Exclude bots (Bugbot, Codex, Copilot) and any historical approval invalidated by a later push or CHANGES_REQUESTED.\n` +
        `SEPARATELY, report approvedByLabel:true whenever the PR currently carries the \`epic approved\` LABEL. PRESENCE IS THE WHOLE TEST: do not check when it was applied, do not compare it against the head commit, do not treat a later push as invalidating it. The owner signs the objective off with this label as well as by comment, and an epic-spec PR takes commits continuously as feedback is folded — so a staleness rule would revoke the approval on the next edit and hold the entire set. A label is standing state the owner can REMOVE; removal is the revocation. Check the labels even when you find no approving comment. Report it independently of \`approved\` — do not fold one into the other, and do not infer it from body text claiming approval.\n` +
        `ALSO report humanChangesRequested:true when any human's LATEST review state is CHANGES_REQUESTED. It outranks the label, which the coordinator applies on approval and which therefore survives a later change request. Bots never count.\n` +
        `ACTIVITY CURSOR: last seen activity at ${epic.lastSeenActivityAt || 'never'} (head ${epic.lastSeenSha || 'unknown'}). Set newReviewEvents ONLY for comments/reviews strictly newer than that TIMESTAMP — a comment never changes the head SHA, so the SHA alone cannot tell you what was already folded. Report latestActivityAt = the newest comment/review timestamp you saw.`,
      { label: 'gate:epic', phase: 'Refresh', schema: GATE_SCHEMA, agentType: 'scout' },
    ),
  () =>
    agent(
      `In ONE Linear query, fetch epic issue ${epic.issueId}, all of its sub-issues (parent→children), AND these issues already tracked under this epic: ${rows.map((r) => r.id).join(', ') || '(none)'}. Return each one's id, current state name, its CATEGORY label, and the ids of any open blocked-by relations. Do not fetch them individually.\n` +
        `The category is what ROUTES the issue: "Bug" sends it straight to implementation with no spec. Report the label verbatim; report null if the issue genuinely carries no category label, and never infer one from the title — an unread category safely keeps the issue on the spec route, an invented one can send a feature to implementation ungated.\n` +
        `The carried ids matter separately from the children: orchestration.md keeps an existing functional parent and links such a member to the epic with relates-to, so it is NEVER in the parent→children set. Omitting it froze its Linear state at whatever was last cached — a blocked member never noticed its prerequisite merge, and a cancelled one kept being dispatched.`,
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
            ? `This issue also has an assembled-goal REPAIR PR #${row.assembledGoal.fixPr} open (the end-to-end goal failed after its sub-PRs merged). Report repairMerged and repairReadyToMerge for it, and repairClosedUnmerged if it was closed without merging.\n`
            : '') +
          `Read the PRs' comments, reviews, check-runs and PR meta (state/mergedAt). specApproved is true ONLY for a human approving comment, or a review whose LATEST state is APPROVED on the CURRENT head by a non-author human. Collapse each human's reviews to their latest state first: if ANY human's latest state is CHANGES_REQUESTED the spec is NOT approved, even when another human has a current-head approval and even when the same person approved earlier. A stale approval invalidated by a later push is not approval either, and no bot review counts.\n` +
          `SEPARATELY report specApprovedByLabel:true whenever the spec PR currently carries the \`spec approved\` LABEL. PRESENCE IS THE WHOLE TEST — do not check when it was applied and do not treat a later push as invalidating it. The owner signs specs off with this label as well as by comment, and a spec PR takes commits while review is folded, so expiring it would revoke the approval on the next round. Removal is the revocation. Report it independently of specApproved.\n` +
          `ALSO report humanChangesRequested:true when any human's LATEST review state on the spec PR is CHANGES_REQUESTED. This OUTRANKS the label: an approval already mirrored to the label stays on the PR after a change request lands, so without this a stale mirror carries the issue into implementation past feedback nobody addressed. Bots never count.\n` +
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
// NO dead-scout fallback at all, which REVERSES an earlier decision here. Carrying the approval through a
// dead scan was sound while the epic approval was a one-time objective sign-off; round-29 work made it
// HEAD-SENSITIVE (a push invalidates it), and nothing revisited the fallback. The hole that left: H1 is
// approved, a push creates H2, and the scout dies on the next wake — `headUnconfirmed` is still false
// because no live scan has seen H2, so the carried `true` released every child worker against an objective
// nobody approved. `headUnconfirmed` only ever covered the case where a LIVE scan came back headless.
//
// The cost is one wake of held work whenever the scout flakes, and the next usable scan releases it. The
// alternative is children authoring specs and PRs against an objective that may have just changed, which
// costs their rework. This is the gate the file says everywhere must not be bypassable.
// Either channel signs the objective off. The owner marks approval with the `epic approved` LABEL as
// well as by comment, and reading only comments held a fully-approved epic's entire set indefinitely
// while the label sat on the PR — the coordinator has no way to assert the gate from `args`, because
// a live scan's answer overrides the carried one by design.
//
// The label does NOT expire on a push, and that difference from a review approval is deliberate. An
// epic-spec PR takes commits for the life of the epic — every fold is one, #993 carries 94 — so a
// staleness rule would revoke the objective on the next edit and re-hold the whole set, which is the
// stall this change exists to remove. A label is standing state the owner can remove at any time, so
// REMOVAL is the revocation, and it is a control a comment does not have.
const epicApproved = scanned && gateUsable && !gate.humanChangesRequested && (!!gate.approved || !!gate.approvedByLabel)
let headUnconfirmed = scanned ? !gateUsable : !!epic.headUnconfirmed
if (!scanned && epic.approved) {
  log(
    `Epic gate scout died — holding child work for this wake rather than releasing it against an approval no live scan could confirm is still current.`,
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

for (const row of rows) {
  const li = linearById.get(row.id)
  if (li && CANCELLED_LINEAR.test((li.state || '').trim()) && (row.blocker || (row.unsettled || []).length)) {
    log(`${row.id} was cancelled with an open question ("${row.blocker || (row.unsettled || [])[0]?.claim}") — dropping it, since there is no longer any work to apply an answer to.`)
  }
}

if (discovered.length) {
  log(
    `Discovered ${discovered.length} new sub-issue(s) under the epic: ${discovered.map((d) => d.id).join(', ')} — entering at their route's entry phase ` +
      `(NEEDS_SPEC, or NEEDS_IMPLEMENTATION for a bug, which the refresh below corrects from the Linear category).`,
  )
}

/**
 * Drop blocked-by relations whose prerequisite has already finished.
 *
 * The scout schema calls this field "Open blocked-by relations", but nothing enforces it, and a
 * scout that reports a merged prerequisite blocks the row PERMANENTLY: `pendingAction` refuses a
 * row with any `blockedBy`, and the refresh overwrites the carried value, so the coordinator
 * cannot correct it from `args` either. One over-reported id is enough to strand an issue for the
 * rest of the epic.
 *
 * Only blockers this epic can SEE are dropped — `linearById` covers the epic's children, so a
 * blocker outside the epic is unresolvable here and is kept. That fails closed: a stale block
 * costs a wake, an incorrectly cleared one runs an issue concurrently with its prerequisite.
 *
 * FINISHED, not merely terminal. `TERMINAL_LINEAR` also matches cancelled / duplicate / dropped —
 * states where the work is GONE rather than done. Clearing those would admit a dependent whose
 * prerequisite never landed, which is the opposite failure and a worse one. A cancelled blocker
 * keeps blocking and is logged, because it can never merge on its own: somebody has to decide
 * whether the dependent still needs it, and a silent permanent stall is how that decision gets
 * missed.
 */
const cancelledBlockers = new Set()
const openBlockers = (ids) =>
  (ids || []).filter((b) => {
    const bs = linearById.get(b)
    if (!bs) return true
    const state = (bs.state || '').trim()
    if (!TERMINAL_LINEAR.test(state)) return true
    if (CANCELLED_LINEAR.test(state)) {
      cancelledBlockers.add(`${b} (${state})`)
      return true
    }
    return false
  })

const refreshed = [...rows, ...discovered].map((row) => {
  const fresh = freshById.get(row.id) || {}
  const refreshedLive = freshById.has(row.id)
  const li = linearById.get(row.id) || {}
  // Hoisted because the phase guard below needs the approval decision, and an object literal cannot read
  // its own fields.
  const scanApproved = specApprovalFor(row, fresh, refreshedLive)
  // Hoisted for the same reason `scanApproved` is: the route depends on the RESOLVED spec handle
  // (an existing spec PR keeps the issue on the spec route whatever its label says), and an object
  // literal cannot read its own fields.
  const resolvedSpecPr = fresh.specPr == null ? row.specPr : fresh.specPr
  const route = routeFor(row, li, linearById.has(row.id), resolvedSpecPr)
  return {
    ...row,
    ...fresh,
    id: row.id,
    // Re-derived from the Linear category every wake, so relabelling an issue re-routes it —
    // and never taken from the carried row alone, which would freeze a mislabel forever.
    // → orchestration.md § "Which issues get a spec".
    route,
    // Durable handles survive a scan that reports them as null. Both are declared `['number','null']`,
    // so a scout omitting or nulling one was schema-valid and the spread destroyed it: an
    // AWAITING_SPEC_APPROVAL row would emit an approval gate with no PR to approve, and a PR_FEEDBACK
    // row would lose the handle its subscription and merge gate are derived from — with no action able
    // to recover either, since nothing re-derives a PR number from scratch. BP-030: tolerate the old
    // shape, and treat null as "did not observe" rather than "no longer exists". The cost is a closed
    // spec PR staying on the row until a worker replaces it, which is visible; the alternative was a
    // gate pointing at nothing, which is not.
    specPr: resolvedSpecPr,
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
    specApproved: scanApproved,
    // The SCOUT jumps the gate too. `jumpsTheApprovalGate` was applied to the worker's report, but the
    // refresh is an INDEPENDENT producer of `phase`: a scan reporting `PR_FEEDBACK` with an impl handle on a
    // row still awaiting approval walked straight past it, and `approvalGatedPhase` only repairs the one
    // intermediate phase. Same rule, other channel.
    phase: scoutPhaseFor(row, fresh.phase, scanApproved, route),
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
    // CANCELLED work carries no unanswered question. `pendingAction` already refuses to dispatch it, so a
    // blocker left on the row could never be cleared by anything — and it kept the surfaced blockers list
    // non-empty, which held the whole epic short of wrap while a human was asked to answer a question about
    // work that no longer exists. Cleared here, in the one place cancellation is observed, so the blockers
    // list and `mayWrap` cannot disagree about it. Logged below, never silent — the same rule cancelled
    // verdicts already follow.
    ...(linearById.has(row.id) && CANCELLED_LINEAR.test((li.state || '').trim()) && (row.blocker || (row.unsettled || []).length)
      ? { blocker: null, blockerFor: null, unsettled: [] }
      : {}),
    // Distinguish "the refresh didn't see this row" from "the refresh saw it and it has no
    // blockers". A present row is authoritative and CLEARS a resolved blocker (its absent
    // `blockedBy` is schema-valid and means none); an absent row means the scout died or
    // skipped it, so the carried relation stands. Getting this backwards either un-blocks an
    // issue on a failed refresh or blocks it forever after its prerequisite merged.
    blockedBy: openBlockers(linearById.has(row.id) ? li.blockedBy : row.blockedBy),
    // Counters are the coordinator's, never the scout's — they survive across wakes.
    specReviewRounds: carriedCount(row, 'specReviewRounds', 'spec_review_rounds'),
    specLevelFound: carriedFlag(row, 'specLevelFound', 'spec_level_found'),
    prFeedbackRounds: carriedCount(row, 'prFeedbackRounds', 'pr_feedback_rounds'),
    // Carried human decisions, as a list and aimed. Computed from the CARRIED row so an untargeted
    // answer can still be attributed to the slice the row surfaced — `foldMultiPrScan` below lifts the
    // next sibling over `blockerFor`, and after that the aim is unrecoverable.
    blockerResolutions: normalizeResolutions(row),
    blockerResolution: null,
    blockerResolutionFor: null,
    // A multi-PR row's live handles: merged sub-PRs, a merged repair, a resolved repair blocker.
    ...foldMultiPrScan(row, fresh, refreshedLive),
  }
})
  // Derived AFTER the fold, because it reads the freshly-merged sub-PRs and the folded goal. A
  // scout naming this phase either finishes the issue without its assembled goal or stalls it.
  .map((row) => {
    // `directRoutePhase` BEFORE `approvalGatedPhase`, and the latter exempts direct rows too. Both,
    // because the ordering alone is a rule the next edit can quietly reverse, and getting it wrong
    // is a bug loop rather than a stall: the correction knocks the row to NEEDS_SPEC and the wake
    // authors the spec this route exists to skip.
    const derived = multiPrPhase(row) || directRoutePhase(row) || approvalGatedPhase(row) || mergeDerivedPhase(row)
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
// `carriedFlag` for the same reason the row-level `spec_level_found` needed it: the counter was dual-read
// while the flag that AUTHORIZES the third round was not, so an epic resumed from the previous lifecycle
// instructions read two rounds with no authorization and skipped a round the rules allow.
const epicAtBudget = atReviewBudget(epicReviewRounds, carriedFlag(epic, 'aboveBarFound', 'above_bar_found'))
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

// The cross-spec gate, as state — computed from the REFRESHED rows, because `specApproved` is scan-derived
// and never carried, so the incoming table cannot answer "is every spec approved". It is OWED once every
// planned spec is open and individually approved and the pass has not cleared; the coordinator is the only
// thing that can clear it, since running the pass needs the user's approval first.
// Two DIFFERENT conditions, which the first version of this conflated — and the conflation released the
// very first approved spec while its siblings were still being written.
//
// The HOLD is the whole rule: `epic-lifecycle` runs one coherence pass "before any of them is built", so a
// multi-issue epic parks EVERY approved row from the first approval until the pass clears. Keying the hold
// on "all specs approved" made it engage far too late — by then the first spec had been built for wakes,
// which is exactly the order the gate exists to prevent.
// A row is settled enough to enter the pass three ways, and this has to be ONE predicate because the
// gate's `issueIds` is the same question asked again. Filtering that list on `specApproved` alone omitted
// exactly the rows the two other arms admit: a sibling already implementing or done normally has no
// observable spec approval (its spec PR is closed), so a re-run triggered by a newly discovered child
// reviewed the newcomer against nothing and reported coherence it never checked.
const crossSpecEligible = (r) => r.specApproved || POST_SPEC_PHASES.has(r.phase) || r.linearTerminal
// Both conditions are derived from ONE definition of the set, because every version that defined them
// separately disagreed about what the set was — and each disagreement was either a released gate or a
// deadlock. Two exclusions, for two different reasons:
//  - CANCELLED work: its spec is dead. Reviewing it manufactures conflicts with work nobody is doing.
//  - BLOCKED work with no spec yet: `allocate` refuses to author it while a `blockedBy` is open, so it
//    can never become eligible on its own. Waiting for it is not a wait — B blocked by A, A held for the
//    pass, the pass waiting on B's spec is a closed loop that no event breaks. A blocked row that ALREADY
//    has a spec is in the set as normal; the exclusion is about what can still arrive, not about who is
//    admitted to work.
const crossSpecCancelled = (r) => CANCELLED_LINEAR.test((r.linearState || '').trim())
// A THIRD exclusion, and it has to apply to both halves: a row with NO SPEC DOCUMENT cannot be
// cross-reviewed. Left in `crossSpecSet` it hands the reviewer a row with nothing to read and
// invites a conflict report about a document that does not exist; left in `crossSpecComing` it is
// a spec that will never arrive, so the pass is never askable and every feature in the epic is
// held behind it — a deadlock, and the one this file has produced twice before by defining the
// two halves apart.
//
// Keyed on the ROUTE, and deliberately not on "does this row have a spec handle" — review
// proposed widening it to `POST_SPEC_PHASES.has(phase) && !specPr`, to also catch a bug relabelled
// Feature *after* its fix was built (it re-routes to `spec` but no spec was ever written, so it
// joins the set as a phantom member). That widening is REFUSED because it collides with a stronger
// invariant pinned one test over: a spec-route sibling that is already implementing has a CLOSED
// spec PR and, in the shape that test fixes, no observable handle either — excluding it would hand
// the reviewer a subset while reporting coherence over the whole set, which is the worse of the two
// failures by a distance. Distinguishing the two states needs a durable "was ever direct" field,
// and a relabel-mid-review is not worth one: the residual cost is a wasted read on a row with no
// document, bounded and gating nothing.
//
// (`pendingAction` separately refuses to let `crossSpecHold` park a direct row, so a bug keeps
// implementing while its sibling features wait on the pass. Both are needed: this keeps the bug
// out of the question, that keeps the question from stopping the bug.)
const crossSpecRows = refreshed.filter((r) => !isDirectRoute(r))
const crossSpecSet = crossSpecRows.filter((r) => crossSpecEligible(r) && !crossSpecCancelled(r))
const crossSpecComing = crossSpecRows.filter(
  (r) => !crossSpecEligible(r) && !crossSpecCancelled(r) && !(r.blockedBy && r.blockedBy.length),
)
// The HOLD is the whole rule: `epic-lifecycle` runs one coherence pass "before any of them is built", so a
// multi-issue epic parks EVERY approved row from the first approval until the pass clears. Keying the hold
// on "all specs approved" made it engage far too late — by then the first spec had been built for wakes,
// which is exactly the order the gate exists to prevent. What it takes is a SET: two specs that exist or
// are still coming. One spec has nothing to be incoherent with, and holding for a pass that can never be
// asked is the deadlock again by a different route.
crossSpecHold = !input.crossSpecCleared && crossSpecSet.length + crossSpecComing.length > 1
// The ASK is narrower, and that is the skill's other precondition: the pass runs only once every spec is
// open and individually approved, because aligning a good spec to an unvalidated one spreads the flaw.
// No "and the set has two entries" clause: the hold already requires `set + coming > 1`, so with nothing
// still coming the set holds at least two by construction. Adding it back would be a guard that cannot
// fire, and the surfaced `issueIds` relies on that derivation rather than on a second test of it.
const crossSpecAskable = crossSpecHold && crossSpecComing.length === 0
if (crossSpecHold && refreshed.some((r) => r.specApproved && !POST_SPEC_PHASES.has(r.phase))) {
  log(
    crossSpecAskable
      ? `All ${crossSpecSet.length} specs in the set are open and individually approved — holding implementation until the cross-spec coherence pass clears. Surface it: the user approves running it.`
      : `Holding approved specs: the cross-spec coherence pass has not cleared, and the set is checked before any of it is built. Not askable yet — ${crossSpecComing.map((r) => r.id).join(', ')} ${crossSpecComing.length === 1 ? 'has' : 'have'} no approved spec.`,
  )
}

const plan = allocate(refreshed, claims, cap, foldEpicWanted, epicApproved)

// No silent caps — say what was held back and why.
if (!epicApproved) {
  log(
    `Epic objective not signed off — holding ${plan.held.length} issue(s) before their first action` +
      `${plan.foldEpic ? ', but still folding epic-PR review so the objective can be revised' : ''}.`,
  )
}
for (const row of plan.blocked) {
  log(`${row.id}: blocked by ${row.blockedBy.join(', ')} — tracked, not admitted to the active set.`)
}
if (cancelledBlockers.size) {
  // A cancelled prerequisite can never merge, so the rows behind it are blocked until a human
  // either drops the relation or revives the work. Said out loud because the alternative — a
  // dependent that simply never runs again, with nothing in the output explaining why — is the
  // failure mode this whole filter exists to remove.
  log(
    `Blocker(s) cancelled, not completed: ${[...cancelledBlockers].join(', ')} — still blocking, because cancelled work never landed. ` +
      `Whoever owns the epic decides whether the dependents still need it; nothing here can clear it.`,
  )
}
for (const row of plan.converged) {
  log(`${row.id}: spec converged (${row.specReviewRounds} rounds spent) — review event logged, awaiting the human gate.`)
}
// No silent stops: the cap is a question for the human, and it is the one hold that looks
// identical to a healthy quiet row from the outside — no gate pending, no blocker text of its own.
for (const row of refreshed.filter(cappedAwaitingDirection)) {
  log(
    `${row.id}: PR-feedback cap reached (${row.prFeedbackRounds} rounds handled) — not auto-handling further feedback. ` +
      `Surfaced for a decision; recording the answer and resetting prFeedbackRounds to 0 is what resumes it.`,
  )
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
// No silent routing. Both directions are worth saying out loud: a bug reaching implementation with no
// spec-approval gate is the one place work is built without a human having seen a plan first, and a
// promotion is a bug that has just become a feature — the human should learn that from the log, not
// from a spec PR appearing for an issue they filed as a bug.
for (const item of plan.advance.filter((i) => i.action === 'implement' && isDirectRoute(i.row))) {
  log(`${item.row.id}: bug — direct route, implementing with no spec. Its only human gate is the merge; the fix is reviewed on its PR.`)
}
for (const r of refreshed.filter((r) => r.specRequired && !isDirectRoute(r))) {
  log(`${r.id}: promoted back to the spec route — ${r.specRequired}`)
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
          // The route has to travel: the worker is a fresh sub-agent that cannot read the coordinator's
          // table, so an unrouted bug worker looks for a spec, finds none, and reports the absence as a
          // readiness problem — the stall the direct route exists to remove.
          (isDirectRoute(item.row)
            // Deliberately does NOT ask the worker to echo the route back. `WORKER_SCHEMA` is
            // `additionalProperties: false` and declares no `route`, so a worker obeying such an
            // instruction fails structured-result validation AFTER doing the implementation — losing
            // the impl PR handle for work that actually happened. The coordinator derives the route
            // from the Linear category every refresh anyway, so there is nothing to echo.
            ? `ROUTE: direct (this is a BUG). No spec-approval gate applies — the impl PR is the review. Diagnose, fix, regression-test, open the impl PR.\n` +
              // The one lookup a direct worker still owes. The routing here is OPTIMISTIC about the
              // absence of a spec: a row discovered this wake was not in the PR-state scout batch (that
              // was built from the carried rows), so its spec handle is UNKNOWN rather than known-absent
              // — and a Bug-labelled issue that already has a spec PR must stay gated. Rather than defer
              // every discovered bug a wake, the check lands where the damage would be done: the worker
              // is the only thing that writes code, and it is already in the repo with `gh` to hand.
              `FIRST, confirm no spec PR exists for this issue (one cheap \`gh pr list --search "spec(<ISSUE>) in:title" --state open\`). If one does, STOP and return specRequired: existing spec PR #N is awaiting approval — the router did not know about it. Do not implement past an open spec gate.\n` +
              `Otherwise the only two things that send it back are yours to decide BEFORE building: no reproduction with an ambiguous symptom, or it is not really a bug (the fix is a new capability or a contract change). Return specRequired: <which and why> instead of building. A design DECISION you hit mid-diagnosis is not one of those — ship your best-judgment fix and surface the decision on the PR with the alternative named.\n`
            : `ROUTE: spec (this issue's approach is gated on a human-approved spec).\n` +
              // A PROMOTED row carries why it left the direct route, and the reason has to travel with
              // it. `issue-spec` shapes a bug's spec differently per override (no-reproduction → the
              // spec is mostly the repro shape and the regression seam; not-really-a-bug → an ordinary
              // feature spec that says so up front). Sending only the generic line makes the fresh
              // worker redo the diagnosis that produced the promotion — and it may well conclude the
              // issue is a clear-repro bug and refuse the spec route, which cycles the row between
              // promotion and reclassification forever. Same handoff rule as a blocker resolution.
              (item.row.specRequired
                ? `This bug was PROMOTED to the spec route by an earlier worker. Its reason, verbatim: "${item.row.specRequired}". Shape the spec around that override (see issue-spec → "Who gets a spec") and do not re-litigate the promotion.\n`
                : '')) +
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
          (item.row.closedBlocker
            ? `A PR on this issue was CLOSED WITHOUT MERGING — that is what the answer above is about. The handle is dead: do not try to push to it or reopen it. If the decision is to rebuild, open a NEW PR for that slice from fresh origin/main and report its handles; if the human reopened it themselves, the next scan will see it and there is nothing to do here.\n` +
              // The rebuild is the worker's to SET UP, because detection is all the script does (see the
              // closed-handle block in `refresh`) and the table it serializes still carries the dead handle
              // as `open`. Handed that verbatim, `issue-multi-pr` classifies the slice `resume` and tells
              // its worker to update the existing PR — explicitly forbidding a replacement. So the two
              // instructions in this prompt contradicted each other, and the reachable outcome was the
              // worse one: the answer spent, nothing rebuilt, and the same question asked again next wake.
              (item.row.subPrs && item.row.subPrs.length
                ? `That rebuild is yours to set up. The table below still carries the dead handle as \`status: "open"\`, and the nested workflow reads that as a slice to RESUME — it would tell its worker to update the closed PR and forbid opening a replacement, so the decision would be spent with nothing rebuilt. Pass that slice to issue-multi-pr as \`status: "pending"\` with its dead \`pr\` and \`branch\` omitted, so it is built instead of resumed, and report the replacement's handles.\n` +
                  (item.row.assembledGoal && item.row.assembledGoal.fixPr
                    ? `If the dead handle is the assembled-goal repair PR #${item.row.assembledGoal.fixPr} rather than a slice, pass \`assembledGoal\` with \`fixPr: null\` instead: the gap issue stays as it is and the repair is re-opened against it. Left set, assembly reports AWAITING_FIX forever on a PR that can never merge.\n`
                    : '')
                : '')
            : '') +
          // The counter is the coordinator's, but only the worker knows whether the batch it just
          // read was a real round. Told nothing, it omits the field and is charged one by default —
          // correct, but it also means a batch of pure acknowledgements silently eats a round.
          (item.action === 'pr-feedback'
            ? `Report \`prFeedbackRoundsSpent\`: 1 for a normal pass over this batch, 0 if it turned out to be only acknowledgements and process chatter with nothing to fix or answer. It is never more than 1 — this dispatch is ONE pass over the outstanding batch, however many PR handles that batch spans. This issue has handled ${item.row.prFeedbackRounds || 0} of ${PR_FEEDBACK_CAP} auto-handled rounds.\n` +
              // CONDITIONAL on this batch actually being a round, which is not knowable until the
              // worker has read it. Stated unconditionally, this told the worker to report 1 and pause
              // — overriding the zero-cost rule one line above for exactly the batch it names, parking
              // the issue at a twelfth round that was never spent and claiming twelve handled rounds on
              // the PR.
              ((item.row.prFeedbackRounds || 0) >= PR_FEEDBACK_CAP - 1
                ? `IF this batch is a real round, it is the LAST auto-handled one — after it, feedback handling stops until a human gives direction. In that case: finish the batch properly (every code comment answered), then post the pause comment on the PR per issue-implement 10.7 — the round count, the threads still open, and your read on whether this is converging or the same objection keeps coming back. ` +
                  // NOT as a `blocker`: an escalating worker is charged zero rounds and keeps its
                  // batch unconsumed, so reporting one here would stop the counter one short of the
                  // cap, re-deliver this batch after the human answered, and re-post its replies.
                  // The counter is the mechanism; the coordinator surfaces the ask from it.
                  `Do NOT report a \`blocker\` for the cap itself — the coordinator raises it from the count. (A blocker for some OTHER decision you genuinely can't make is unaffected.) ` +
                  `If instead the batch turns out to be acknowledgements only, report 0 as above and post NO pause comment: no round was spent, the cap is not reached, and the loop continues.\n`
                : '')
            : '') +
          (item.action === 'pr-feedback' && item.row.newSpecReviewEvents
            ? `Some of this row's unhandled activity is on its SPEC PR ${item.row.specPr ? `#${item.row.specPr}` : '(retained or closed)'}, not on the implementation PR. Read it and carry it as implementer notes — do not spend a spec review round on it and do not reopen the spec. The spec is approved; this is late commentary that must not be lost, and this pass is the only one that sees it.\n`
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
            ? `This issue implements as a DAG of sub-PRs. Advance it with the issue-multi-pr workflow, passing this state as its args — including \`cap: ${Math.max(1, cap)}\` — and return the updated subPrs table AND assembledGoal.\n` +
              `That cap is not optional: omitting it leaves the nested workflow on its own default, so a single outer worker can spawn that many sub-PR worktrees beneath itself and several outer rows multiply it. The number here is sized to this VM, and it stops meaning anything if the nested fan-out ignores it.\n` +
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
              `ONE exception, and it is the opposite failure: report multiPrPending FALSE when the workflow returns \`blockedGap\` after a recheck. That repair is waiting on an open Linear relation — an external event by definition — so reporting true asks for an immediate wake that rechecks an unchanged relation and burns a slot in the shared cap, every wake, until someone else moves it.\n` +
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
    .filter((r) => !((r.newPrEvents || r.newSpecReviewEvents) && !cursorUsable(r)))
    // A merge gate requires a POST-SPEC phase, independently of the handles. Refusing the worker's phase
    // jump was not enough on its own: the gate is derived from `readyToMerge && implPr`, and a worker
    // reporting those from a pre-approval row still produced a merge gate for a spec nobody approved.
    // Keeping the handle but refusing the gate loses nothing — an orphaned PR still needs tracking — while
    // a merge gate on a row that is still AWAITING_SPEC_APPROVAL is incoherent whatever produced it.
    .filter((r) => POST_SPEC_PHASES.has(r.phase))
    // ...and not while a VERDICT is still unfolded. Settle runs after Advance, so a POC returning REFUTED
    // or INCONCLUSIVE lands in the same wake a refresh may have marked the PR ready — and merging then locks
    // in an implementation whose load-bearing premise the evidence just contradicted, before any wake has
    // folded it. One wake's delay against a merge nobody can take back.
    .filter((r) => !(r.verdicts || []).length)

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

// Hoisted so the wrap predicate below reads the SAME epic state that goes out, rather than a second
// copy of the conditions that would drift from it.
const epicOut = {
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
    approved: gateUsable ? !gate.humanChangesRequested && (!!gate.approved || !!gate.approvedByLabel) : !!epic.approved,
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
    // `carriedFlag`, not `epic.aboveBarFound`: the budget check normalizes the legacy `above_bar_found`, and
    // preserving only the camelCase field here persisted a resumed epic as UNAUTHORIZED the moment any
    // zero-round fold ran — so the next wake declared convergence and skipped the permitted third round.
    // Normalizing in one place and dropping it in the other is the same defect twice.
    aboveBarFound:
      epicFold && (epicFold.roundsSpent || 0) > 0 ? !!epicFold.aboveBar : carriedFlag(epic, 'aboveBarFound', 'above_bar_found'),
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
}

// Hoisted for the same reason: `mayWrap` asks whether anything is still owed to the human, and the
// surfaced list is the only honest answer to that.
const epicBlockers = [
    ...issues.filter((r) => r.blocker).map((r) => ({ issueId: r.id, blocker: r.blocker })),
    // DERIVED, not a stored blocker: the cap is a property of the counter, so there is no second
    // field that can disagree with it and nothing for the coordinator to forget to set. Resetting
    // the counter is what removes this entry — the same act that un-parks the row — so the
    // surfaced question and the park can never get out of step. It also holds `mayWrap`: an epic
    // must not close over an issue whose review loop we stopped without an answer.
    //
    // ...but only while the work still EXISTS, which is `cappedAwaitingDirection`'s liveness clause —
    // the same predicate the gates withhold on and the log reports, so the three cannot disagree
    // about which rows are capped.
    ...issues
      .filter((r) => cappedAwaitingDirection(r) && !r.blocker)
      .map((r) => ({
        issueId: r.id,
        blocker:
          `PR-feedback cap reached — ${r.prFeedbackRounds} rounds handled on ${r.implPr ? `#${r.implPr}` : 'this issue'} and feedback is no longer being auto-handled. ` +
          `Is this converging slowly, or is the approach the problem? Answer to resume (the answer resets the counter); the worker's read on the open threads is on the PR.`,
      })),
    ...epicUnsettled.map((u) => ({ issueId: epic.issueId, blocker: `POC returned INCONCLUSIVE — needs a human decision: ${u.claim}`, evidence: u.evidence, threads: u.threads })),
    ...epicOpenQuestions.map((q) => ({ issueId: epic.issueId, blocker: `Epic-spec open question — needs a human: ${q}` })),
]

return {
  epicApproved,
  epic: epicOut,
  epicFold: epicFold ? { folded: epicFold.folded, fanOut: epicFold.fanOut || [] } : null,
  // Converged epic-PR feedback, read but not folded — the coordinator routes each note to the
  // issues it names as an implementer note. Empty/absent when nothing needed routing.
  epicNotes: epicNotes ? epicNotes.notes || [] : null,
  issues,
  gates,
  blockers: epicBlockers,
  // The coordinator has to ASK before running the pass, so this is a gate like any other — without it the
  // hold above would be a silent stall rather than a question waiting on an answer.
  // The set the ask was decided on, verbatim — a list derived a second time here is a list that can
  // disagree with the question, which is how the pass came to be handed a subset and told the rest was
  // reviewed. Askable already guarantees this has at least two entries.
  ...(crossSpecAskable ? { crossSpecGate: { issueIds: crossSpecSet.map((r) => r.id) } } : {}),
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
  // ---- Two decisions the coordinator was restating in prose. ---------------------------------------
  //
  // Both are DERIVED FROM `pendingAction`, deliberately, after a first version enumerated the state
  // fields that imply work. That list was wrong in five separate ways in one round — it counted a verdict
  // parked behind a blocker (which `pendingAction` refuses to dispatch, so the "run again now" loop had no
  // exit), it counted a verdict on a CANCELLED row that nothing can ever apply (stranding the epic short
  // of wrap forever), and it missed `multiPrPending` and a fold the cap squeezed out. Enumerating what
  // implies work is the same drift the predicates exist to remove — one wake's dispatcher is the only
  // thing that actually knows.
  //
  // RUN ANOTHER WAKE NOW: something is dispatchable with no external event. Either the planner has
  // leftovers it could not fit, or a row's post-wake state is one `pendingAction` would act on — which
  // covers a returned `multiPrPending` row, a landed verdict still owed a fold, and a Settle-phase verdict
  // that Advance had already passed by. A parked or cancelled row yields null and so ends the turn.
  moreWorkNow:
    plan.heldForFold.length > 0 ||
    plan.deferred.length > 0 ||
    plan.queuedClaims.length + unsettled.length + newRequests.length > 0 ||
    (foldEpicWanted && !plan.foldEpic) ||
    // A row that is dispatchable AND whose trigger needs no external event. `pendingAction` alone was too
    // broad: `consumedFlags` clears the activity flags but not `ciFailed`, so a row whose CI failure this
    // wake just handled comes back still-failing and read as runnable — an immediate wake, every wake,
    // hammering the row while CI is red. CI re-running is an external event, and so is a new review.
    //
    // These three are not: DAG work the nested step reported, a verdict still owed a fold (Settle runs
    // after Advance, so the planner never saw it), and a queued human answer. Pairing them with
    // `pendingAction` is what keeps a parked or cancelled row out — that was the original defect.
    issues.some(
      (r) =>
        (r.multiPrPending || (r.verdicts || []).length || (r.blockerResolutions || []).length) && pendingAction(r) !== null,
    ) ||
    // A ROUTE PROMOTION is the fourth internal trigger. A direct worker that refused to build
    // returns `specRequired` and leaves the row at NEEDS_SPEC — spec authoring is runnable
    // immediately, and the row has no PR, so nothing external will ever wake it. Same reasoning as
    // a cap-deferred NEEDS_SPEC row, which this list already covers.
    //
    // Keyed on the TRANSITION (set now, absent on the carried row), not on `specRequired` being
    // present: the field is sticky by design, so testing presence would keep re-asserting
    // "work now" for the rest of the row's life. `issues` is a 1:1 map of `refreshed`, so the
    // index is the carried counterpart.
    issues.some((r, i) => r.specRequired && !refreshed[i].specRequired && pendingAction(r) !== null),
  // SAFE TO WRAP: every row is terminal, nothing is dispatchable, and no human decision is outstanding.
  // The blockers list is the authority on the last of those, because it is exactly what gets surfaced —
  // so "nothing left to show the human" and "safe to close the surface" cannot disagree. Cancelled rows
  // need no exception here: they are dispatchable-null and carry no blocker, so their leftover verdict
  // state, which nothing can apply, stops holding the epic open.
  mayWrap:
    issues.every((r) => r.linearTerminal || r.merged || r.phase === 'DONE') &&
    !issues.some((r) => pendingAction(r) !== null) &&
    // Row-level unsettled evidence is a question owed to the human even where the blocker text has been
    // cleared, and `pendingAction` is null for a terminal row carrying it. Scoped to LIVE rows: on
    // cancelled work there is nothing left to apply a decision to, so counting it there is what stranded
    // the epic short of wrap with no action able to release it.
    !issues.some((r) => (r.unsettled || []).length && !CANCELLED_LINEAR.test((r.linearState || '').trim())) &&
    epicBlockers.length === 0 &&
    (epicOut.verdicts || []).length === 0 &&
    (epicOut.answers || []).length === 0 &&
    plan.queuedClaims.length + unsettled.length + newRequests.length === 0,
}
