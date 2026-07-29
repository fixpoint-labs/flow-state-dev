/**
 * issue-multi-pr — advance a multi-PR issue's plan by one bounded step.
 *
 * When a spec declares a PR plan (`issue-spec` Part II §8), the issue's implementation is a
 * DAG of sub-PRs rather than one PR. Three things about that DAG are pure procedure, and
 * all three were prose the orchestrator had to re-derive every wake:
 *
 *   1. The ready set — which sub-PRs can start, and on what base. A sub-PR whose deps are
 *      all MERGED bases on fresh origin/main; one whose deps are merely OPEN stacks on the
 *      dep's branch so review can start before the dep merges.
 *   2. The rebase — a stacked sub-PR whose dep has since merged has to come off the dep's
 *      branch onto main, or it carries the dep's commits into its own diff.
 *   3. The assembled goal — the last merge does NOT make the issue DONE. Each sub-PR only
 *      proved its own slice; the end-to-end goal is the proof no single sub-PR could give,
 *      and the merges are the first moment it is runnable.
 *
 * What stays with the orchestrator (a script cannot do it): the merge gate on every sub-PR,
 * PR subscriptions, waiting for a dependency to merge, and the `.orchestration/` cache.
 * State arrives via `args`, leaves via the return value.
 *
 * Canonical rules: `issue-lifecycle` → "Multi-PR issues", and
 * `docs/contributing/orchestration.md` → "Worktree branching".
 *
 * Verified by `.agents/workflows/verify.mjs` (stubbed hooks, no agents spawned).
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
  const deps = (node.dependsOn || []).map((id) => byId.get(id)).filter(Boolean)
  const allMerged = deps.every((d) => d.status === TERMINAL)
  const allAtLeastOpen = deps.every((d) => d.status === TERMINAL || d.status === 'open')

  if (node.status === 'pending') {
    if (allMerged) return { action: 'build', base: 'origin/main' }
    // Stack on the dep so review can start now. Multiple open deps can't be stacked
    // coherently — wait for them to converge rather than pick one arbitrarily.
    const openDeps = deps.filter((d) => d.status === 'open')
    if (allAtLeastOpen && openDeps.length === 1) return { action: 'build', base: openDeps[0].branch }
    return null
  }

  // A stacked sub-PR whose deps have all merged now belongs on main.
  if (node.status === 'open' && node.stackedOn && allMerged) {
    return { action: 'rebase', base: 'origin/main' }
  }

  return null
}

/** Ready sub-PRs this wake, capped; plus what the cap held back. */
function readySet(nodes, cap) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const ready = []
  for (const node of nodes) {
    const next = classify(node, byId)
    if (next) ready.push({ node, ...next })
  }
  return { ready: ready.slice(0, cap), deferred: ready.slice(cap) }
}

/**
 * Does the assembled end-to-end goal still need running?
 *
 * Every sub-PR merged is necessary but not sufficient. Two ways it is already satisfied:
 * the spec designated an integrating sub-PR that owns the goal (don't double-run — just
 * confirm the verdict was recorded), or a previous wake already ran it and it passed.
 */
function assembledGoalNeeded(nodes, goal) {
  if (!nodes.length) return false
  if (!nodes.every((n) => n.status === TERMINAL)) return false
  if (goal && goal.passed) return false
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
    stackedOn: { type: ['string', 'null'], description: 'The dep branch this stacked on, if any — drives the later rebase' },
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

  // The sub-PRs are already merged and their branches may be gone, so the repair is a NEW
  // fix PR owned by the breaking slice — not a reopen. The issue stays out of DONE.
  log(`Assembled goal FAILED for ${issueId} — filing the gap and opening a fix PR. Issue is not DONE.`)
  const fix = await agent(
    `The assembled end-to-end goal for ${issueId} failed after all sub-PRs merged.\nFailure: ${(verdict && verdict.failure) || 'unknown'}\nLikely owning slice: ${(verdict && verdict.owningSubPr) || 'unknown'}\n` +
      `File the gap as a Linear issue related to ${issueId} (issue-manager conventions), then open a NEW fix PR against the default branch that makes the assembled goal pass. Do not attempt to reopen the merged sub-PRs.`,
    { label: `assembled-fix:${issueId}`, phase: 'Assemble', schema: FIX_SCHEMA, agentType: 'issue-worker', isolation: 'worktree' },
  )

  return {
    issueId,
    subPrs: nodes,
    assembledGoal: { ...goal, passed: false, failure: verdict ? verdict.failure : 'goal agent returned nothing' },
    fix: fix || null,
    done: false,
  }
}

// ---- Otherwise: advance the DAG's ready set. -------------------------------------------
phase('Build')

const { ready, deferred } = readySet(nodes, cap)

if (!ready.length) {
  const waiting = nodes.filter((n) => n.status !== TERMINAL).map((n) => `${n.id}(${n.status})`)
  log(`No sub-PR is ready — waiting on ${waiting.join(', ') || 'nothing'}.`)
  return { issueId, subPrs: nodes, dispatched: [], done: false }
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

const subPrs = nodes.map((node) => {
  const r = resultById.get(node.id)
  if (!r) return node
  return {
    ...node,
    status: r.status === 'failed' ? node.status : r.status,
    pr: r.pr === undefined || r.pr === null ? node.pr : r.pr,
    branch: r.branch || node.branch,
    // A rebase clears the stack marker; a fresh build sets it when it stacked.
    stackedOn: ready.find((i) => i.node.id === node.id && i.action === 'rebase') ? null : r.stackedOn || node.stackedOn || null,
    blocker: r.blocker || null,
    summary: r.summary,
  }
})

return {
  issueId,
  subPrs,
  dispatched: ready.map((i) => `${i.action}:${i.node.id}`),
  deferred: deferred.map((i) => i.node.id),
  blockers: subPrs.filter((n) => n.blocker).map((n) => ({ id: n.id, blocker: n.blocker })),
  // Never DONE from a build wake — merges are the human's, and the assembled goal comes after.
  done: false,
}
