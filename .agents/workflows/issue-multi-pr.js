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
  // A sub-PR whose worker escalated a decision is WAITING ON A HUMAN, whatever its status says.
  // Re-dispatching would drop the executor back at the fork it was required to escalate. The
  // coordinator clears `blocker` when it records the answer. (Same rule as epic-wake's rows.)
  if (node.blocker) return null

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
  if (goal.passed) return 'DONE'
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
const nodes = args.subPrs || []
const cap = Number.isFinite(args.cap) && args.cap > 0 ? args.cap : 3
const goal = args.assembledGoal || {}

// ---- Assemble: one state, one action per wake. -----------------------------------------
const state = assembleState(nodes, goal)

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
    { label: `gap-recheck:${issueId}`, phase: 'Assemble', schema: GAP_SCHEMA, agentType: 'scout' },
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

  if (goal.fixMerged) log(`Repair ${goal.fixPr ? `#${goal.fixPr}` : goal.fixIssue} merged — re-running the assembled goal to prove it.`)
  if (goal.ownedBy) log(`Assembled goal is owned by sub-PR ${goal.ownedBy} — confirming its recorded verdict, not re-running it.`)

  const verdict = await agent(
    goal.ownedBy
      ? `Sub-PR ${goal.ownedBy} of ${issueId} was designated to own the assembled end-to-end goal. Confirm its run was recorded and PASSED — read the verdict, do not re-run the goal. Report passed accordingly.`
      : `Every sub-PR of ${issueId} has merged. Run the spec's end-to-end goal against the fully-assembled result on the REAL path. Use a real model if the goal declares one; a model-free goal runs as-is. A cost-based skip is not an acceptable outcome — run it. Report PASS/FAIL with the command and what it proved, and name the sub-PR that broke it if it failed.`,
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
    `The assembled end-to-end goal for ${issueId} failed after all its sub-PRs merged.\nFailure: ${goal.failure}\nLikely owning slice: ${goal.owningSubPr || 'unknown'}\n` +
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
    `Fix the assembled end-to-end goal failure for ${issueId}, tracked as ${goal.fixIssue}.\nFailure: ${goal.failure}\nLikely owning slice: ${goal.owningSubPr || 'unknown'}\n` +
      `Open a NEW fix PR against the default branch that makes the assembled goal pass. A previous attempt may have died part-way — check for an existing branch or PR for ${goal.fixIssue} before creating another. The sub-PRs are already merged and their branches may be gone, so do not attempt to reopen them.`,
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
  return { issueId, subPrs: nodes, assembledGoal: { ...goal, fixPr: fix.pr }, fix, done: false }
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

  // "open" needs BOTH handles to be usable: without the PR the coordinator can't subscribe or
  // surface a merge gate, and without the branch a dependent would stack on `undefined`. Either
  // one missing makes it an incomplete build, so the next wake retries.
  const openWithoutHandles = !rebasing && r.status === 'open' && (!(r.pr || node.pr) || !(r.branch || node.branch))
  if (openWithoutHandles) {
    log(`${node.id}: reported open but returned no PR number or branch — treating as incomplete, will retry.`)
    return { ...node, blocker: r.blocker || null, summary: r.summary }
  }

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
