/**
 * issue-multi-pr — advance a multi-PR issue's plan by one bounded step.
 *
 * NOT RUNNABLE STANDALONE. This is a Claude Code **Workflow script**, not an ESM module — the
 * harness injects `agent` / `parallel` / `pipeline` / `log` / `phase` / `args` as globals and
 * wraps the body in an async function, which is why the top-level `return` below is legal.
 * Contract: `docs/contributing/orchestration.md` → "The workflow-script contract".
 *
 * When a spec declares a PR plan (`issue-spec` Part II §8), the issue's implementation is a
 * DAG of sub-PRs rather than one PR. The ready set, the base each sub-PR takes, the rebase a
 * merged dependency forces, and the assembled end-to-end goal are pure procedure — canonical
 * in `issue-lifecycle` § "Multi-PR issues" and `orchestration.md` § "Worktree branching".
 *
 * NOTE — deliberate twin of framework code. `classify`/`readySet` below re-derive what
 * `packages/orchestration` already does for tasks (`topologicalDispatcher`,
 * `depsSatisfied` in `src/tasks/`), because a workflow script cannot import. The semantics
 * intentionally differ: this one picks a git *base* per node (merged dep → origin/main,
 * single open dep → stack on its branch), which task dispatch has no concept of. Keep them
 * separate, but check both when the DAG rules change.
 *
 * What stays with the orchestrator (a script cannot do it): the merge gate on every sub-PR,
 * PR subscriptions, waiting for a dependency to merge, and the `.orchestration/` cache.
 *
 * ## A null agent result means NOTHING HAPPENED
 *
 * `agent()` returns `null` when the sub-agent dies or is skipped. That is infrastructure
 * failure, not an outcome — so every `null` here carries the previous state forward unchanged
 * and lets the next wake retry. Never synthesize a verdict, a status, or a cleared marker from
 * one: a fabricated failure files duplicate work, and a fabricated success loses the retry.
 * Same principle in `epic-wake.js`.
 */

export const meta = {
  name: 'issue-multi-pr',
  description:
    "Advance a multi-PR issue's DAG by one step: derive the ready set, build independents in parallel worktrees, stack dependents on their dependency, rebase what a merge has unstacked, and run the assembled end-to-end goal once every sub-PR has merged.",
  whenToUse:
    'Dispatched by issue-lifecycle (or by an epic issue-worker) when the spec declares a PR plan. Not for single-PR issues — those are a one-node plan and need no DAG step.',
  phases: [
    { title: 'Build', detail: 'one worktree worker per ready sub-PR' },
    { title: 'Assemble', detail: 'end-to-end goal on the fully-merged result' },
  ],
}

// ---------------------------------------------------------------------------
// Rules (pure — these are what the verify harness asserts)
// ---------------------------------------------------------------------------

const TERMINAL = 'merged'

/**
 * Classify one sub-PR into the action it needs this wake, or null if it is waiting.
 *
 * `base` is the load-bearing output: stacking on a dep's branch is what lets a dependent
 * open for review before its dependency merges, and getting it wrong either blocks review
 * unnecessarily (waiting for the merge) or pollutes the diff (stacking on an already-merged
 * dep instead of rebasing onto main).
 */
/**
 * A node's dependency edges, under either documented spelling.
 *
 * `issue-spec`'s PR-plan table and `issue-lifecycle`'s cache row both write `depends_on`; this script
 * read only `dependsOn` and nothing converted. A coordinator following its own documented cache format
 * hands over rows whose edges read as EMPTY — which `readySet` treats as "all deps merged", so a
 * dependent is built straight onto `origin/main` alongside the prerequisite it declared. Twin of
 * `dependsOnOf` in epic-wake.js; a workflow script cannot import, so change them together.
 */
function dependsOnOf(node) {
  const edges = node.dependsOn === undefined ? node.depends_on : node.dependsOn
  return Array.isArray(edges) ? edges : []
}

/**
 * @param answeredIds ids whose escalated decision the human has answered but no worker has applied yet
 */
function classify(node, byId, answeredIds) {
  // A sub-PR whose worker escalated a decision is WAITING ON A HUMAN, whatever its status says.
  // Re-dispatching would drop the executor back at the fork it was required to escalate. The
  // coordinator clears `blocker` when it records the answer. (Same rule as epic-wake's rows.)
  // ...unless it has been answered, in which case the answer needs DELIVERING (below).
  if (node.blocker && !(answeredIds && answeredIds.has(node.id))) return null

  // Every declared dep is guaranteed resolvable here — readySet() rejects a node with a
  // missing one rather than letting it through (see `invalid` there).
  const deps = dependsOnOf(node).map((id) => byId.get(id))
  const allMerged = deps.every((d) => d.status === TERMINAL)
  const allAtLeastOpen = deps.every((d) => d.status === TERMINAL || d.status === 'open')

  if (node.status === 'pending') {
    if (allMerged) return { action: 'build', base: 'origin/main' }
    // Stack on the dep so review can start now — but ONLY when it is the sole dependency.
    // A mix of merged and open deps can't be stacked safely: the open dep's branch may have
    // been cut before the merged one landed, so building on it would omit declared
    // prerequisite code (C needs merged A + open B, and B's branch predates A). Waiting costs
    // a wake; building against an incomplete base costs a wrong implementation.
    // Both handles, not just the status. Without a BRANCH an `open` dep yields `base: undefined`, and
    // the build prompt then tells its worker to base the slice on nothing — it would start from the
    // inherited checkout or some other unintended ref instead of its prerequisite. Waiting costs a
    // wake; building on an unknown base costs a wrong implementation, the same trade the mixed-deps
    // rule above makes. Without a PR NUMBER it has no subscribable or mergeable handle, so it can
    // never merge — and `classify` only rebases a stacked dependent once its deps have merged, so
    // stacking on it strands both slices with no remaining action at all.
    // ...and never on a dep carrying a BLOCKER, in either of its two states. Unanswered, the dependent
    // would encode one side of an architectural fork the human has explicitly not settled. Answered, the
    // dep's `resume` and this build are dispatched in the SAME `parallel()` call, so the dependent would
    // base itself on a branch that is being pushed to as it reads it. Waiting one wake is the same trade
    // the two rules above already make.
    const openDeps = deps.filter((d) => d.status === 'open')
    if (allAtLeastOpen && deps.length === 1 && openDeps.length === 1 && openDeps[0].branch && openDeps[0].pr && !openDeps[0].blocker) {
      return { action: 'build', base: openDeps[0].branch }
    }
    return null
  }

  // An OPEN slice whose escalated decision has just been answered needs a worker to APPLY it.
  //
  // Clearing the blocker was not enough and was worse than the stall it replaced: `classify` has no
  // action for an ordinary open node, so nothing consumed the answer — while the slice, now reading as
  // unblocked, became eligible for a merge gate. The human would be invited to merge an implementation
  // that ignores the decision they were asked for. A stall is recoverable; merging the wrong thing is
  // not. So the answer itself is the action, on the slice's existing PR and base.
  if (node.status === 'open' && answeredIds && answeredIds.has(node.id)) {
    return { action: 'resume', base: node.stackedOn || 'origin/main' }
  }

  // A stacked sub-PR whose deps have all merged now belongs on main.
  if (node.status === 'open' && node.stackedOn && allMerged) {
    return { action: 'rebase', base: 'origin/main' }
  }

  return null
}

/**
 * Ready sub-PRs this wake, capped; plus what the cap held back and what the table got wrong.
 *
 * A `dependsOn` id that isn't in the table (a cache-persistence slip, a malformed parsed plan)
 * must **fail closed**. Dropping it would leave the node with zero deps, which reads as
 * "everything merged" and builds a dependent straight onto origin/main before its prerequisite
 * exists — the DAG violated by the one input we can't trust.
 */
function readySet(nodes, cap, answeredIds) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const ready = []
  const invalid = []
  // Duplicate ids are a malformed plan too, and worse than an unresolvable one: `byId` silently
  // keeps the last of each pair while the loop below still visits every row, so both would be
  // dispatched — two workers building and pushing the SAME branch concurrently, then one result
  // applied to both rows. Refused before anything is scheduled.
  const dupes = new Set()
  const counted = new Set()
  for (const n of nodes) {
    if (counted.has(n.id)) dupes.add(n.id)
    counted.add(n.id)
  }
  // A dependency CYCLE is a malformed plan, not a wait: no merge and no other external event can
  // ever unblock it, so reporting the nodes as "waiting" parks the issue silently forever. Only a
  // human fixing the plan resolves it, so it is reported as invalid like an unresolvable id.
  const inCycle = new Set()
  const seen = new Map() // id -> 1 visiting, 2 done
  const walk = (id, stack) => {
    if (seen.get(id) === 2) return
    if (stack.includes(id)) {
      for (const n of stack.slice(stack.indexOf(id))) inCycle.add(n)
      return
    }
    seen.set(id, 1)
    for (const dep of dependsOnOf(byId.get(id) || {})) if (byId.has(dep)) walk(dep, [...stack, id])
    seen.set(id, 2)
  }
  for (const n of nodes) walk(n.id, [])

  for (const node of nodes) {
    if (dupes.has(node.id)) {
      invalid.push({ node, missing: [], duplicate: true })
      continue
    }
    if (inCycle.has(node.id)) {
      invalid.push({ node, missing: [], cycle: true })
      continue
    }
    const missing = dependsOnOf(node).filter((id) => !byId.has(id))
    if (missing.length) {
      invalid.push({ node, missing })
      continue
    }
    const next = classify(node, byId, answeredIds)
    if (next) ready.push({ node, ...next })
  }
  // A malformed plan fails the ENTIRE ready set, not just its own node. `byId` is the map every other
  // node is classified against, so a bad row poisons its descendants: an invalid prerequisite
  // persisted as `merged` reads as satisfied and its pending dependent is dispatched from
  // origin/main in the very wake the plan is being reported as broken. Only a human can fix the plan,
  // and nothing built in the meantime is trustworthy — so nothing is built.
  if (invalid.length) return { ready: [], deferred: [], invalid }
  return { ready: ready.slice(0, cap), deferred: ready.slice(cap), invalid }
}

/** Every sub-PR merged — necessary for the assembled goal, never sufficient for DONE. */
function allMerged(nodes) {
  return nodes.length > 0 && nodes.every((n) => n.status === TERMINAL)
}

/**
 * The assemble phase as an explicit state machine, because the ad-hoc predicates it replaces
 * produced two opposite bugs in as many rounds: one that re-ran the goal and filed a duplicate
 * repair every wake, and then a guard that blocked the rerun but dispatched no repair either,
 * stalling the issue permanently after a single dead agent.
 *
 * Every state is derived from durable handles alone, and each names exactly one next action.
 * The order is the recovery path: a repair that dies mid-way resumes at the stage it reached.
 *
 *   null            — sub-PRs still building; assemble isn't reachable yet
 *   NEEDS_GOAL      — all merged, no confirmed failure → run (or confirm) the end-to-end goal
 *   NEEDS_GAP       — goal failed, no gap issue filed  → file it via `issue-manager`
 *   GAP_BLOCKED     — the filed gap is itself blocked  → RE-CHECK it; a blocked state with no way
 *                                                        to observe its blocker clearing is a stall,
 *                                                        not a wait
 *   REPAIR_BLOCKED  — the repair hit a human decision   → park; the coordinator clears `fixBlocker`
 *   NEEDS_FIX       — gap filed and ready, no repair PR → open the repair PR
 *   AWAITING_FIX    — repair PR open, not merged        → wait; the human merges it
 *   DONE            — the goal passed on the assembled result
 *
 * `fixMerged` returns to NEEDS_GOAL rather than DONE: a landed repair still has to be proven.
 * And if that proof FAILS, the caller clears the spent handles so this lands in NEEDS_GAP for a
 * fresh repair cycle — leaving a merged PR in `fixPr` would read as AWAITING_FIX forever.
 */
function assembleState(nodes, goal) {
  if (!allMerged(nodes)) return null
  // BOTH, matching `goalPassed()` in epic-wake.js — a bare boolean is not a proof, and `GOAL_SCHEMA`
  // requires `evidence` for exactly that reason. The two predicates disagreeing was worse than either
  // being wrong alone: the epic refused DONE on `{ passed: true }` and re-dispatched, this returned DONE
  // immediately without running the goal, and the pair looped forever doing nothing. Falling through to
  // NEEDS_GOAL re-runs the goal, which produces the evidence both sides are asking for.
  if (goal.passed && goal.evidence) return 'DONE'
  // A confirmed failure is what distinguishes "not run yet" from "run and failed". A dead goal
  // agent records nothing, so it lands back here and retries rather than inventing a defect.
  if (!goal.failure) return 'NEEDS_GOAL'
  if (goal.fixMerged) return 'NEEDS_GOAL'
  if (!goal.fixIssue) return 'NEEDS_GAP'
  // `issue-manager` reported the gap it filed is blocked. Starting repair work anyway would
  // ignore the one verdict that agent exists to give.
  // A repair escalated to the human parks until the coordinator records the decision by clearing
  // `fixBlocker` — the same park-and-clear contract as an issue row's `blocker`.
  if (goal.fixBlocker) return 'REPAIR_BLOCKED'
  if (goal.fixReady === false) return 'GAP_BLOCKED'
  if (!goal.fixPr) return 'NEEDS_FIX'
  return 'AWAITING_FIX'
}

// ---------------------------------------------------------------------------
// Agent result schemas
// ---------------------------------------------------------------------------

const BUILD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'status'],
  properties: {
    id: { type: 'string' },
    status: { type: 'string', enum: ['open', 'pending', 'failed'] },
    pr: { type: ['number', 'null'] },
    branch: { type: ['string', 'null'] },
    blocker: { type: ['string', 'null'] },
    summary: { type: 'string', description: 'One compact line' },
  },
}

const GOAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  // `evidence` is required alongside `passed`: DONE claims the goal was proven on the real path,
  // and a pass with no command and no observed result proves nothing.
  required: ['passed', 'evidence'],
  properties: {
    passed: { type: 'boolean' },
    evidence: { type: 'string', description: 'The command run and what it proved — a real model when the goal declares one; a model-free goal runs as-is' },
    failure: { type: ['string', 'null'] },
    owningSubPr: { type: ['string', 'null'], description: 'Which slice broke it, when it failed' },
  },
}

/** What `issue-manager` returns for the filed gap. */
const GAP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  // `ready` is REQUIRED: it is the verdict this agent exists to give, and treating an omission
  // as "ready" would start repair work the manager may have meant to block.
  required: ['issueFiled', 'ready'],
  properties: {
    issueFiled: { type: 'string', description: 'The Linear issue ID it filed (or the existing duplicate it found)' },
    ready: { type: 'boolean', description: 'False when the filed gap has an unresolved blocker of its own' },
    summary: { type: 'string' },
  },
}

/**
 * The gap RE-CHECK's own schema — readiness only, no filing.
 *
 * It used to reuse GAP_SCHEMA, whose `required` includes `issueFiled`. The recheck prompt asks for
 * readiness and explicitly says to change nothing, so the compliant `{ ready: true }` answer was
 * rejected by the validating hook and came back as `null` — read as "the scout died", leaving the
 * repair in GAP_BLOCKED and re-checking forever. A prompt and a schema that disagree is a stall.
 */
const GAP_RECHECK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ready'],
  properties: {
    ready: { type: 'boolean', description: 'Is the gap issue pickable now — no open blocking relation?' },
    summary: { type: 'string' },
  },
}

const FIX_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['pr'],
  properties: {
    pr: { type: ['number', 'null'] },
    // A repair can hit an architectural fork it must escalate rather than guess. Without this the
    // only way to say so was `pr: null`, which reads as "incomplete" and re-dispatches the worker
    // at the same undecided fork every wake.
    blocker: { type: ['string', 'null'], description: 'Needs a human decision — parks the repair and is surfaced' },
    summary: { type: 'string' },
  },
}

// ---------------------------------------------------------------------------
// The step
// ---------------------------------------------------------------------------

const issueId = args.issueId
// The human's answer to a decision a slice escalated, forwarded by the caller.
//
// This DAG's workers are the ones that hit the fork — the escalation came from a build or fix worker,
// not from the caller — so a resolution that stops at the caller stops one agent too early: the worker
// that resumes is freshly spawned, never saw the question, and can only escalate it again or guess.
// Same channel as `epic-wake`'s `blockerResolution`, one hop further down. Consumed by the caller
// (which clears its copy once it has dispatched), so this script only reads it.
// A LIST, because two slices can escalate in one wake and a single slot silently drops one of the
// answers — see `normalizeResolutions` in epic-wake.js for the sequence that guarantees it.
const resolutions = [
  ...(args.blockerResolutions || []).filter((r) => r && r.answer).map((r) => ({ for: r.for || null, answer: r.answer })),
  // BP-030: the single-slot shape, tolerated on the way in.
  ...(args.blockerResolution ? [{ for: args.blockerResolutionFor || null, answer: args.blockerResolution }] : []),
]
/**
 * The single slice an UNTARGETED answer belongs to, if that is unambiguous.
 *
 * A legacy single-slot `blockerResolution` carries no target. Treating it as "aimed at the issue" handed it
 * to every ready node, so an unrelated pending slice dispatched in the same wake was told to implement
 * another slice's architectural decision as given — contaminating a PR the decision had nothing to do with.
 * Exactly one slice is blocked in that situation, and it is the one that asked.
 */
const blockedNodeIds = (args.subPrs || []).filter((n) => n.blocker).map((n) => n.id)
const untargetedOwner = blockedNodeIds.length === 1 ? blockedNodeIds[0] : null

/** Answers aimed at this node — by name, or as the sole blocked slice an untargeted answer must belong to. */
const resolutionsFor = (nodeId) =>
  resolutions.filter((r) => (r.for ? r.for === nodeId : untargetedOwner ? untargetedOwner === nodeId : true))
const resolutionNote = (nodeId) => {
  const mine = resolutionsFor(nodeId)
  if (!mine.length) return ''
  return (
    `\n${mine.length === 1 ? 'A decision' : `${mine.length} decisions`} this slice escalated ${mine.length === 1 ? 'has' : 'have'} been ANSWERED by the human:\n` +
    mine.map((r) => `  - ${r.answer}`).join('\n') +
    `\nImplement as given — do not re-derive the choice and do not escalate the same fork again. If one does not answer the fork you actually hit, report a new blocker naming precisely what is still open.\n`
  )
}

// AN ANSWER IS WHAT CLEARS THE BLOCKER IT ANSWERS, here rather than only in the caller.
//
// `classify()` refuses to dispatch a node whose `blocker` is set and `assembleState()` returns
// REPAIR_BLOCKED on `goal.fixBlocker` — both correct, and both unreachable-past for a standalone
// caller. `epic-wake` clears the nested copies in its refresh, so under an epic the forwarding worked;
// invoked directly from `issue-lifecycle` there was no equivalent step, so a supplied resolution could
// never reach a worker and the answered slice stayed blocked forever. Deriving the clearing from the
// answer makes it caller-independent, and it is idempotent when the caller already did it.
const rowLevelAnswer = resolutions.some((r) => !r.for)
// An untargeted answer belongs to whichever slice is blocked — the caller lifts one at a time, so there
// is at most one. Resolved into concrete ids here so `classify` needs to know nothing about aiming.
const answeredIds = new Set([
  ...resolutions.map((r) => r.for).filter(Boolean),
  ...(rowLevelAnswer ? (args.subPrs || []).filter((n) => n.blocker).map((n) => n.id) : []),
])

// Tolerate the status the previous, prose-driven path persisted. `issue-lifecycle` documents the
// cached statuses as `building / open / merged`, but a wake is synchronous — a node either has a
// PR (`open`) or does not (`pending`) — so `classify()` only knows the latter pair. A carried
// `building` node therefore matched no branch, produced no action, and logged as "waiting" on
// every wake with no external event able to move it: a permanent stall. It normalizes to
// `pending`, which retries the build; a build that never returned left no PR to lose. (BP-030.)
const nodes = (args.subPrs || [])
  .map((n) => (n.status === 'building' ? { ...n, status: 'pending' } : n))
  // Clear the blocker each answer resolves (see above). A row-level answer with no slice named clears
  // whichever slice is blocked, matching how `epic-wake` lifts one nested blocker at a time.
  // NOT cleared here, for either status. `classify` lets an answered node through (see `answeredIds`)
  // and the blocker is cleared when the DELIVERING WORKER RETURNS — the same rule as every other piece of
  // state in this script. Clearing it up-front looked harmless for a pending slice ("the build is the
  // delivery") and lost the decision whenever that build died: the node persisted already-unblocked while
  // the caller consumed the one-shot resolution, so the next worker reached the fork with nothing.
  // A dead worker must mutate nothing.
for (const n of args.subPrs || []) {
  if (n.status === 'building') log(`${n.id}: carried status "building" is not a state a wake can resume — retrying the build.`)
}
const cap = Number.isFinite(args.cap) && args.cap > 0 ? args.cap : 3
const goal = { ...(args.assembledGoal || {}) }

// The repair blocker is the third copy of the same decision (row, sub-PR, goal), and it gets the same
// treatment: an answer RELEASES the repair, and the blocker is cleared once the fix worker has actually
// returned — not before it runs, or a dead worker would leave the decision spent and the fork unanswered.
const repairAnswered = !!goal.fixBlocker && (rowLevelAnswer || answeredIds.has(goal.owningSubPr))
if (repairAnswered) {
  log(`Repair blocker for ${issueId} was answered by the human — releasing the repair; the blocker clears once a fix worker returns.`)
}
// ---- Assemble: one state, one action per wake. -----------------------------------------
const state = assembleState(nodes, repairAnswered ? { ...goal, fixBlocker: null } : goal)

if (state === 'DONE') {
  return { issueId, subPrs: nodes, assembledGoal: goal, done: true }
}

if (state === 'AWAITING_FIX') {
  log(`Assembled goal failed earlier; fix PR #${goal.fixPr} has not merged — not re-running the goal, not filing a duplicate.`)
  return { issueId, subPrs: nodes, assembledGoal: goal, awaitingFix: goal.fixPr, done: false }
}

if (state === 'REPAIR_BLOCKED') {
  log(`Repair for ${issueId} is parked on a human decision: ${goal.fixBlocker}. Clear \`fixBlocker\` once answered.`)
  return { issueId, subPrs: nodes, assembledGoal: goal, blocker: goal.fixBlocker, done: false }
}

if (state === 'GAP_BLOCKED') {
  phase('Assemble')
  // Re-derive readiness rather than trusting the cached verdict. Parking on a stale `fixReady:
  // false` forever is the stall this branch exists to avoid: nothing else in the system ever
  // clears that field, so the repair could never start once its blocker was resolved externally.
  const recheck = await agent(
    `Linear issue ${goal.fixIssue} is the repair gap for ${issueId}, previously reported as blocked. Re-read it: is it still blocked by an open relation, or is it ready to pick up now? Report readiness only — change nothing.`,
    { label: `gap-recheck:${issueId}`, phase: 'Assemble', schema: GAP_RECHECK_SCHEMA, agentType: 'scout' },
  )

  if (!recheck) {
    log(`Could not re-check gap ${goal.fixIssue} (scout returned nothing) — still parked, will re-check next wake.`)
    return { issueId, subPrs: nodes, assembledGoal: goal, blockedGap: goal.fixIssue, incomplete: 'gap-recheck', done: false }
  }

  if (recheck.ready !== true) {
    log(`Gap ${goal.fixIssue} is still blocked — parked, re-checking each wake.`)
    return { issueId, subPrs: nodes, assembledGoal: goal, blockedGap: goal.fixIssue, done: false }
  }

  log(`Gap ${goal.fixIssue} is unblocked now — the repair PR is next.`)
  return { issueId, subPrs: nodes, assembledGoal: { ...goal, fixReady: true }, done: false }
}

if (state === 'NEEDS_GOAL') {
  phase('Assemble')

  // REMOVED: an "a designated sub-PR already ran the goal, so confirm its record instead of
  // re-running" shortcut. Nothing in the orchestration ever set `assembledGoal.ownedBy` — no
  // coordinator produced it and no contract documented it — so the branch was unreachable, and the
  // one round it did get exercised (in tests) it turned out to accept a verdict recorded before a
  // repair merged. The goal always runs. It costs one real-path run; the shortcut cost correctness,
  // and saving a run is not worth a stale proof.
  if (goal.fixMerged) log(`Repair ${goal.fixPr ? `#${goal.fixPr}` : goal.fixIssue} merged — re-running the assembled goal to prove it.`)

  const verdict = await agent(
    `Every sub-PR of ${issueId} has merged. FIRST fetch and check out fresh origin/main in your worktree — the checkout you inherit may predate some of those merges, and a goal run against a tree missing a merged slice records a verdict about code that does not exist. THEN run the spec's end-to-end goal against the fully-assembled result on the REAL path. Use a real model if the goal declares one; a model-free goal runs as-is. A cost-based skip is not an acceptable outcome — run it. Report PASS/FAIL with the command and what it proved, and name the sub-PR that broke it if it failed.`,
    { label: `assembled-goal:${issueId}`, phase: 'Assemble', schema: GOAL_SCHEMA, agentType: 'issue-worker', isolation: 'worktree' },
  )

  if (verdict && verdict.passed) {
    if (!verdict.evidence) {
      log(`Assembled goal reported PASS for ${issueId} with no evidence — not accepting it as proof; retrying next wake.`)
      return { issueId, subPrs: nodes, assembledGoal: goal, incomplete: 'assembled-goal', done: false }
    }
    return { issueId, subPrs: nodes, assembledGoal: { ...goal, passed: true, evidence: verdict.evidence }, done: true }
  }

  // No verdict is an incomplete attempt, NOT a failure: recording one would invent a defect
  // nobody observed and send the machine into NEEDS_GAP off a dead agent.
  if (!verdict) {
    log(`Assembled-goal agent returned nothing for ${issueId} — incomplete attempt, retrying next wake. No gap filed.`)
    return { issueId, subPrs: nodes, assembledGoal: goal, incomplete: 'assembled-goal', done: false }
  }

  // Record the confirmed failure and stop. The repair is the NEXT state's job, so a repair agent
  // that dies resumes from the stage it reached instead of re-running this goal.
  log(`Assembled goal FAILED for ${issueId} — recording the failure; the repair starts next. Issue is not DONE.`)
  return {
    issueId,
    subPrs: nodes,
    assembledGoal: {
      ...goal,
      passed: false,
      failure: verdict.failure || 'unspecified',
      // Keep the evidence, not just the verdict. It is schema-REQUIRED precisely because it carries
      // the command and the observed result, and the gap and repair workers that run next are the
      // ones that need to reproduce the failure — a terse `failure` string leaves them guessing at
      // what actually broke.
      evidence: verdict.evidence || null,
      owningSubPr: verdict.owningSubPr || null,
      // Clear any SPENT repair handles. If this failure came from re-verifying a repair that
      // already merged, carrying its PR forward would put the machine in AWAITING_FIX on a
      // merged PR — a permanent stall instead of a fresh repair cycle.
      fixIssue: null,
      fixPr: null,
      fixReady: undefined,
      fixMerged: false,
    },
    done: false,
  }
}

if (state === 'NEEDS_GAP') {
  phase('Assemble')
  // File through the `issue-manager` AGENT, not by asking a worker to imitate it: the duplicate
  // check, project placement and relation wiring are that agent's job (AGENTS.md → "File
  // discovered work"). A near-duplicate gap issue wired to nothing is worse than none.
  const filed = await agent(
    `The assembled end-to-end goal for ${issueId} failed after all its sub-PRs merged.\nFailure: ${goal.failure}\nEvidence (what was run and what happened): ${goal.evidence || 'none recorded'}\nLikely owning slice: ${goal.owningSubPr || 'unknown'}\n` +
      `File this gap as a Linear issue related to ${issueId}, in the same project. Duplicate-check first — a previous attempt may already have filed it. Return the issue ID and whether it is ready to pick up.`,
    { label: `assembled-gap:${issueId}`, phase: 'Assemble', schema: GAP_SCHEMA, agentType: 'issue-manager' },
  )

  if (!filed) {
    log(`issue-manager returned nothing for ${issueId} — still owed a gap issue; retrying that stage next wake, not the goal.`)
    return { issueId, subPrs: nodes, assembledGoal: goal, incomplete: 'assembled-gap', done: false }
  }

  const ready = filed.ready === true
  log(`Gap filed as ${filed.issueFiled} for ${issueId} — ${ready ? 'the repair PR is next' : 'BLOCKED per issue-manager; parking until its blocker clears'}.`)
  return { issueId, subPrs: nodes, assembledGoal: { ...goal, fixIssue: filed.issueFiled, fixReady: ready }, done: false }
}

if (state === 'NEEDS_FIX') {
  phase('Assemble')
  const fix = await agent(
    `Fix the assembled end-to-end goal failure for ${issueId}, tracked as ${goal.fixIssue}.\nFailure: ${goal.failure}\nEvidence (what was run and what happened): ${goal.evidence || 'none recorded'}\nLikely owning slice: ${goal.owningSubPr || 'unknown'}\n` +
      `Fetch origin and branch from FRESH origin/main first — your worktree starts on the lifecycle's checkout, which drifts as slices merge. Basing the repair on it would put unrelated commits in the fix PR, or omit the very merged slices whose interaction the goal is failing on.\n` +
      `Then open a NEW fix PR against the default branch that makes the assembled goal pass. A previous attempt may have died part-way — check for an existing branch or PR for ${goal.fixIssue} before creating another. The sub-PRs are already merged and their branches may be gone, so do not attempt to reopen them.` +
      resolutionNote(goal.owningSubPr),
    { label: `assembled-fix:${issueId}`, phase: 'Assemble', schema: FIX_SCHEMA, agentType: 'issue-worker', isolation: 'worktree' },
  )

  if (fix && fix.blocker) {
    log(`Repair for ${issueId} is blocked on a human decision: ${fix.blocker} — parked, not retried.`)
    return { issueId, subPrs: nodes, assembledGoal: { ...goal, fixBlocker: fix.blocker }, blocker: fix.blocker, done: false }
  }

  if (!fix || !fix.pr) {
    log(`No repair PR opened for ${issueId} yet (${fix ? 'worker reported none' : 'worker returned nothing'}) — retrying that stage next wake.`)
    return { issueId, subPrs: nodes, assembledGoal: goal, incomplete: 'assembled-fix', done: false }
  }

  log(`Repair PR #${fix.pr} opened for ${issueId}. Merge is yours; the goal re-runs once it lands.`)
  // `fixBlocker: null` because THIS is where an answered repair decision is spent — the worker ran with
  // the answer in its prompt and opened the PR. Carrying the blocker through would re-park the repair on
  // the next wake, when the one-shot resolution is gone, and re-ask a question already answered and acted
  // on. The two paths above deliberately do NOT clear it: a fresh escalation replaces it, and a worker
  // that returned nothing delivered nothing.
  return { issueId, subPrs: nodes, assembledGoal: { ...goal, fixPr: fix.pr, fixBlocker: null }, fix, done: false }
}

// ---- Otherwise: advance the DAG's ready set. -------------------------------------------
phase('Build')

const { ready, deferred, invalid } = readySet(nodes, cap, answeredIds)

for (const bad of invalid) {
  log(
    bad.duplicate
      ? `${bad.node.id}: appears MORE THAN ONCE in the plan — refusing to build it. Two workers would push the same branch. Fix the PR plan or the handle cache.`
      : bad.cycle
        ? `${bad.node.id}: part of a dependency CYCLE — no event can unblock it. Fix the PR plan; this is not a wait.`
        : `${bad.node.id}: declares unknown dependenc(ies) ${bad.missing.join(', ')} — refusing to build it. Fix the PR plan or the handle cache.`,
  )
}

if (!ready.length) {
  const waiting = nodes.filter((n) => n.status !== TERMINAL).map((n) => `${n.id}(${n.status})`)
  log(`No sub-PR is ready — waiting on ${waiting.join(', ') || 'nothing'}.`)
  return { issueId, subPrs: nodes, dispatched: [], invalid: invalid.map((b) => ({ id: b.node.id, missing: b.missing, cycle: !!b.cycle, duplicate: !!b.duplicate })), done: false }
}

if (deferred.length) {
  log(`Cap ${cap} reached — deferring ${deferred.map((d) => d.node.id).join(', ')} to the next wake.`)
}

const built = await parallel(
  ready.map((item) => () =>
    agent(
      item.action === 'resume'
        ? `Sub-PR ${item.node.id} of ${issueId} (PR #${item.node.pr}, branch ${item.node.branch}) stopped on a decision only a human could make, and it has now been ANSWERED.\n` +
          `Fetch and check out ${item.node.branch} first — your worktree is fresh and starts on the lifecycle's checkout, NOT on this sub-PR.\n` +
          `Apply the decision to that EXISTING PR: update the implementation, run \`review\`, push. Do not open a new PR and do not merge it. Report status: open.\n` +
          `If the answer does not resolve the fork you actually hit, leave the PR as it is and report a new blocker naming precisely what is still open.` +
          resolutionNote(item.node.id)
        : item.action === 'rebase'
        ? `Sub-PR ${item.node.id} of ${issueId} (PR #${item.node.pr}, branch ${item.node.branch}) was stacked on ${item.node.stackedOn}, which has now merged.\n` +
          `Fetch and check out ${item.node.branch} first — your worktree is fresh and starts on the lifecycle's checkout, NOT on this sub-PR. Rebasing whatever you inherited would move the wrong branch, and a reported success clears the stack marker so nothing retries it.\n` +
          `Then rebase it onto fresh ${item.base} so its diff carries only its own slice, push, and report. Do not merge it.` +
          resolutionNote(item.node.id)
        : `Implement sub-PR ${item.node.id} of ${issueId} in your own worktree.\n` +
          `Branch: fix/${issueId}-${item.node.id}, based on ${item.base}.\n` +
          (item.base === 'origin/main'
            ? `Fetch origin/main first — the checkout you inherited drifts behind as sibling PRs merge.\n`
            : `You are stacking on an unmerged dependency's branch so review can start now; it will be rebased onto main when the dependency merges.\n`) +
          resolutionNote(item.node.id) +
          `Run issue-implement scoped to THIS sub-PR's deliverables only: implement the slice, run \`review\`, open the sub-PR. Stop before merge. Do not prompt the user.`,
      {
        label: `${item.action}:${item.node.id}`,
        phase: 'Build',
        schema: BUILD_SCHEMA,
        agentType: 'issue-worker',
        isolation: 'worktree',
      },
    ),
  ),
)

// Bind each build result to the sub-PR it was DISPATCHED for, by position.
//
// `id` is a free-form string in BUILD_SCHEMA, so keying on the reported value lets worker A's PR,
// branch and status land on node B — or overwrite B's real result — while A stays pending and gets
// rebuilt from scratch next wake. `parallel()` preserves input order, so position is the only
// trustworthy key, and a mismatch is discarded because a result we can't attribute is a result
// that didn't happen (the node keeps its state and the next wake retries).
// Twin of `bindByPosition` in epic-wake.js — a workflow script cannot import, so the rule is
// stated in both places; change them together.
const resultById = new Map()
built.forEach((b, i) => {
  if (!b) return
  const id = ready[i].node.id
  if (b.id && b.id !== id) {
    log(`${id}: worker reported id ${b.id} — discarding the result rather than applying it to another sub-PR; ${id} retries next wake.`)
    return
  }
  resultById.set(id, b)
})
const plannedById = new Map(ready.map((i) => [i.node.id, i]))

const subPrs = nodes.map((node) => {
  const r = resultById.get(node.id)
  if (!r) {
    // A dead RESUME is worth naming: the caller consumes the resolution once it has dispatched, so the
    // answer is spent while the node keeps its blocker. That re-surfaces the same question to the human
    // rather than losing it — recoverable, but it costs them a second ask, so say why.
    const planned = plannedById.get(node.id)
    if (planned && planned.action === 'resume') {
      log(`${node.id}: the worker that was to apply the human's decision did not return — the blocker stays set, so the decision will be asked for again.`)
    }
    return node
  }
  const planned = plannedById.get(node.id)
  // Derive the stack marker from the base THIS SCRIPT chose, never from the worker echoing it
  // back: the field is optional, so a worker that omits it would silently clear the marker —
  // and `classify` only schedules the required rebase while the marker is set, so the sub-PR
  // would keep its dependency's commits in its own diff forever.
  //
  // A rebase clears the marker ONLY on explicit success (`status: 'open'`). Any other outcome
  // — `failed`, or `pending` (also schema-valid) — leaves the sub-PR still stacked, so the
  // marker has to survive or nothing ever retries the rebase and the slice keeps its
  // dependency's commits forever.
  const rebasing = planned && planned.action === 'rebase'
  // ...and NOT while it escalated. `open` alone was read as success, so a rebase that stopped on a human
  // decision cleared the marker: after the answer, `classify` picks the generic `resume`, which applies
  // the decision but never retries the rebase — and the still-stacked PR could then be offered for merge
  // and land its dependency's commits.
  const rebased = rebasing && r.status === 'open' && !r.blocker
  // A resume works on an EXISTING open PR, so like a rebase it can only ever confirm `open` — never
  // demote to `pending`, which the next wake would misread as "never built" and rebuild from scratch.
  const resuming = planned && planned.action === 'resume'

  // "open" needs BOTH handles to be usable: without the PR the coordinator can't subscribe or
  // surface a merge gate, and without the branch a dependent would stack on `undefined`. Either
  // one missing makes it an incomplete build, so the next wake retries.
  const openWithoutHandles = !rebasing && !resuming && r.status === 'open' && (!(r.pr || node.pr) || !(r.branch || node.branch))
  if (openWithoutHandles) {
    log(`${node.id}: reported open but returned no PR number or branch — treating as incomplete, will retry.`)
    // `node.blocker` preserved: an incomplete build delivered nothing, so it spends nothing. This early
    // return sits one branch before the rule below that says exactly that, and cleared the answered
    // slice's blocker anyway — while the outer wake, seeing `subPrs` come back, consumed the one-shot
    // resolution. The retry then hit the architectural fork with no answer.
    return { ...node, blocker: r.blocker || node.blocker || null, summary: r.summary }
  }

  let stackedOn = node.stackedOn || null
  if (rebasing) stackedOn = rebased ? null : node.stackedOn || null
  // A resume does not move the base, so it must not touch the marker either.
  else if (planned && !resuming) stackedOn = planned.base === 'origin/main' ? null : planned.base

  return {
    ...node,
    // A rebase can only ever confirm `open` — it must never demote an already-open sub-PR to
    // `pending`, which the next wake would misread as "never built" and rebuild from scratch.
    status: rebasing || resuming ? node.status : r.status === 'failed' ? node.status : r.status,
    pr: r.pr === undefined || r.pr === null ? node.pr : r.pr,
    branch: r.branch || node.branch,
    stackedOn,
    // Cleared only by a resume that actually SUCCEEDED. `BUILD_SCHEMA` permits `failed` and `pending`,
    // and clearing on those lost the human's decision exactly like a dead worker would: the caller
    // consumes the one-shot resolution, the next wake sees neither a blocker nor a resume action, and a
    // readiness scan can offer the unchanged PR for merge. A worker that reports failure delivered
    // nothing, which is the same rule as a worker that returned nothing.
    // Any delivery that did not reach `open` spends nothing — no longer restricted to `resume`. An
    // answered PENDING slice is delivered by a BUILD, so a schema-valid `failed`/`pending` from that
    // build cleared the blocker while the caller consumed the one-shot answer, and the next build
    // retried the architectural fork blind. For an ordinary unblocked build `node.blocker` is already
    // null, so dropping the action distinction costs nothing and closes the sibling case with it.
    blocker: r.blocker || (r.status !== 'open' ? node.blocker || null : null),
    // EXPLICIT delivery acknowledgement. A resume works on an existing open PR, so a success is
    // `open → open` with no blocker — indistinguishable from a failure by status alone, which left the
    // caller either dropping the answer (if it assumed success) or re-dispatching the same resume forever
    // while the merge gate stayed withheld (if it assumed failure). Neither guess is recoverable; saying so
    // is. Only a resume sets it, and only when it actually landed.
    ...(resuming && r.status === 'open' && !r.blocker ? { answerApplied: true } : {}),
    summary: r.summary,
  }
})

return {
  issueId,
  subPrs,
  dispatched: ready.map((i) => `${i.action}:${i.node.id}`),
  deferred: deferred.map((i) => i.node.id),
  invalid: invalid.map((b) => ({ id: b.node.id, missing: b.missing, cycle: !!b.cycle, duplicate: !!b.duplicate })),
  blockers: subPrs.filter((n) => n.blocker).map((n) => ({ id: n.id, blocker: n.blocker })),
  // Never DONE from a build wake — merges are the human's, and the assembled goal comes after.
  done: false,
}
