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
function classify(node, byId) {
  // Every declared dep is guaranteed resolvable here — readySet() rejects a node with a
  // missing one rather than letting it through (see `invalid` there).
  const deps = (node.dependsOn || []).map((id) => byId.get(id))
  const allMerged = deps.every((d) => d.status === TERMINAL)
  const allAtLeastOpen = deps.every((d) => d.status === TERMINAL || d.status === 'open')

  if (node.status === 'pending') {
    if (allMerged) return { action: 'build', base: 'origin/main' }
    // Stack on the dep so review can start now — but ONLY when it is the sole dependency.
    // A mix of merged and open deps can't be stacked safely: the open dep's branch may have
    // been cut before the merged one landed, so building on it would omit declared
    // prerequisite code (C needs merged A + open B, and B's branch predates A). Waiting costs
    // a wake; building against an incomplete base costs a wrong implementation.
    const openDeps = deps.filter((d) => d.status === 'open')
    if (allAtLeastOpen && deps.length === 1 && openDeps.length === 1) {
      return { action: 'build', base: openDeps[0].branch }
    }
    return null
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
function readySet(nodes, cap) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const ready = []
  const invalid = []
  for (const node of nodes) {
    const missing = (node.dependsOn || []).filter((id) => !byId.has(id))
    if (missing.length) {
      invalid.push({ node, missing })
      continue
    }
    const next = classify(node, byId)
    if (next) ready.push({ node, ...next })
  }
  return { ready: ready.slice(0, cap), deferred: ready.slice(cap), invalid }
}

/** Every sub-PR merged — necessary for the assembled goal, never sufficient for DONE. */
function allMerged(nodes) {
  return nodes.length > 0 && nodes.every((n) => n.status === TERMINAL)
}

/**
 * A previous wake's assembled-goal failure opened a repair PR that hasn't merged yet.
 *
 * This is its own state because without it the failure path loops: the sub-PRs stay merged and
 * `passed` stays false, so the next wake re-runs the goal against unchanged code, fails again,
 * and files a *duplicate* Linear issue and fix PR — every wake, until someone notices.
 */
function awaitingAssembledFix(nodes, goal) {
  // Gate on the repair EXISTING, not on it having a PR: `FIX_SCHEMA` allows `pr: null` (the
  // worker filed the issue but couldn't open a PR), and gating on the PR alone would let that
  // case straight back into the duplicate-filing loop this guard exists to stop.
  const repairInFlight = !!(goal.fixPr || goal.fixIssue)
  return allMerged(nodes) && !goal.passed && repairInFlight && !goal.fixMerged
}

/**
 * Does the assembled end-to-end goal still need running? Two ways it's already satisfied: a
 * previous wake ran it and it passed, or the spec designated an integrating sub-PR that owns
 * it (confirm the recorded verdict, don't double-run).
 */
function assembledGoalNeeded(nodes, goal) {
  if (!allMerged(nodes)) return false
  if (goal && goal.passed) return false
  if (awaitingAssembledFix(nodes, goal)) return false
  return true
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
  required: ['passed'],
  properties: {
    passed: { type: 'boolean' },
    evidence: { type: 'string', description: 'The command run and what it proved — a real model when the goal declares one; a model-free goal runs as-is' },
    failure: { type: ['string', 'null'] },
    owningSubPr: { type: ['string', 'null'], description: 'Which slice broke it, when it failed' },
  },
}

const FIX_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['issueFiled'],
  properties: {
    issueFiled: { type: 'string' },
    pr: { type: ['number', 'null'] },
    summary: { type: 'string' },
  },
}

// ---------------------------------------------------------------------------
// The step
// ---------------------------------------------------------------------------

const issueId = args.issueId
const nodes = args.subPrs || []
const cap = args.cap || 3
const goal = args.assembledGoal || {}

// ---- All merged: the assembled goal is the only thing between here and DONE. -----------
if (assembledGoalNeeded(nodes, goal)) {
  phase('Assemble')

  if (goal.ownedBy) {
    log(`Assembled goal is owned by sub-PR ${goal.ownedBy} — confirming its recorded verdict, not re-running it.`)
  }

  const verdict = await agent(
    goal.ownedBy
      ? `Sub-PR ${goal.ownedBy} of ${issueId} was designated to own the assembled end-to-end goal. Confirm its run was recorded and PASSED — read the verdict, do not re-run the goal. Report passed accordingly.`
      : `Every sub-PR of ${issueId} has merged. Run the spec's end-to-end goal against the fully-assembled result on the REAL path. Use a real model if the goal declares one; a model-free goal runs as-is. A cost-based skip is not an acceptable outcome — run it. Report PASS/FAIL with the command and what it proved, and name the sub-PR that broke it if it failed.`,
    { label: `assembled-goal:${issueId}`, phase: 'Assemble', schema: GOAL_SCHEMA, agentType: 'issue-worker', isolation: 'worktree' },
  )

  if (verdict && verdict.passed) {
    return { issueId, subPrs: nodes, assembledGoal: { ...goal, passed: true, evidence: verdict.evidence }, done: true }
  }

  // No verdict at all is an incomplete attempt, NOT a failure. Filing a gap and opening a
  // repair PR off a dead agent would invent a defect that was never observed — and then the
  // repair gate would suppress the retry that should have happened.
  if (!verdict) {
    log(`Assembled-goal agent returned nothing for ${issueId} — treating as an incomplete attempt; will retry next wake. No gap filed.`)
    return { issueId, subPrs: nodes, assembledGoal: goal, incomplete: 'assembled-goal', done: false }
  }

  // The sub-PRs are already merged and their branches may be gone, so the repair is a NEW
  // fix PR owned by the breaking slice — not a reopen. The issue stays out of DONE.
  log(`Assembled goal FAILED for ${issueId} — filing the gap and opening a fix PR. Issue is not DONE.`)
  const fix = await agent(
    `The assembled end-to-end goal for ${issueId} failed after all sub-PRs merged.\nFailure: ${verdict.failure || 'unknown'}\nLikely owning slice: ${verdict.owningSubPr || 'unknown'}\n` +
      `File the gap as a Linear issue related to ${issueId} (issue-manager conventions), then open a NEW fix PR against the default branch that makes the assembled goal pass. Do not attempt to reopen the merged sub-PRs.`,
    { label: `assembled-fix:${issueId}`, phase: 'Assemble', schema: FIX_SCHEMA, agentType: 'issue-worker', isolation: 'worktree' },
  )

  return {
    issueId,
    subPrs: nodes,
    // `fixPr` is what stops the next wake re-running the goal and filing a duplicate. The
    // coordinator sets `fixMerged` when that PR merges, which re-arms the goal.
    assembledGoal: {
      ...goal,
      passed: false,
      failure: verdict.failure,
      // Record the filed issue as well as the PR: either one is enough to prove a repair is
      // already in flight, and the PR may legitimately be null.
      fixPr: (fix && fix.pr) || null,
      fixIssue: (fix && fix.issueFiled) || null,
      fixMerged: false,
    },
    fix: fix || null,
    done: false,
  }
}

// ---- A repair is in flight: don't re-run the goal, don't file a duplicate. --------------
if (awaitingAssembledFix(nodes, goal)) {
  const repair = goal.fixPr ? `fix PR #${goal.fixPr}` : `filed issue ${goal.fixIssue} (no PR opened yet)`
  log(`Assembled goal failed earlier; ${repair} has not landed — not re-running the goal, not filing a duplicate.`)
  return { issueId, subPrs: nodes, assembledGoal: goal, awaitingFix: goal.fixPr || goal.fixIssue, done: false }
}

// ---- Otherwise: advance the DAG's ready set. -------------------------------------------
phase('Build')

const { ready, deferred, invalid } = readySet(nodes, cap)

for (const bad of invalid) {
  log(`${bad.node.id}: declares unknown dependenc(ies) ${bad.missing.join(', ')} — refusing to build it. Fix the PR plan or the handle cache.`)
}

if (!ready.length) {
  const waiting = nodes.filter((n) => n.status !== TERMINAL).map((n) => `${n.id}(${n.status})`)
  log(`No sub-PR is ready — waiting on ${waiting.join(', ') || 'nothing'}.`)
  return { issueId, subPrs: nodes, dispatched: [], invalid: invalid.map((b) => ({ id: b.node.id, missing: b.missing })), done: false }
}

if (deferred.length) {
  log(`Cap ${cap} reached — deferring ${deferred.map((d) => d.node.id).join(', ')} to the next wake.`)
}

const built = await parallel(
  ready.map((item) => () =>
    agent(
      item.action === 'rebase'
        ? `Sub-PR ${item.node.id} of ${issueId} (PR #${item.node.pr}, branch ${item.node.branch}) was stacked on ${item.node.stackedOn}, which has now merged. Rebase it onto fresh ${item.base} so its diff carries only its own slice, push, and report. Do not merge it.`
        : `Implement sub-PR ${item.node.id} of ${issueId} in your own worktree.\n` +
          `Branch: fix/${issueId}-${item.node.id}, based on ${item.base}.\n` +
          (item.base === 'origin/main'
            ? `Fetch origin/main first — the checkout you inherited drifts behind as sibling PRs merge.\n`
            : `You are stacking on an unmerged dependency's branch so review can start now; it will be rebased onto main when the dependency merges.\n`) +
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

const resultById = new Map(built.filter(Boolean).map((b) => [b.id, b]))
const plannedById = new Map(ready.map((i) => [i.node.id, i]))

const subPrs = nodes.map((node) => {
  const r = resultById.get(node.id)
  if (!r) return node
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
  const rebased = rebasing && r.status === 'open'

  let stackedOn = node.stackedOn || null
  if (rebasing) stackedOn = rebased ? null : node.stackedOn || null
  else if (planned) stackedOn = planned.base === 'origin/main' ? null : planned.base

  return {
    ...node,
    // A rebase can only ever confirm `open` — it must never demote an already-open sub-PR to
    // `pending`, which the next wake would misread as "never built" and rebuild from scratch.
    status: rebasing ? node.status : r.status === 'failed' ? node.status : r.status,
    pr: r.pr === undefined || r.pr === null ? node.pr : r.pr,
    branch: r.branch || node.branch,
    stackedOn,
    blocker: r.blocker || null,
    summary: r.summary,
  }
})

return {
  issueId,
  subPrs,
  dispatched: ready.map((i) => `${i.action}:${i.node.id}`),
  deferred: deferred.map((i) => i.node.id),
  invalid: invalid.map((b) => ({ id: b.node.id, missing: b.missing })),
  blockers: subPrs.filter((n) => n.blocker).map((n) => ({ id: n.id, blocker: n.blocker })),
  // Never DONE from a build wake — merges are the human's, and the assembled goal comes after.
  done: false,
}
