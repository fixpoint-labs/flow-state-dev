/**
 * verify — evidence path for the orchestration workflow scripts (BP-003).
 *
 * The whole reason `epic-wake.js` and `issue-multi-pr.js` exist is that their decisions used
 * to be prose the coordinator re-derived every wake: the spec-review round budget and its
 * conditional third round, the concurrency cap, the claim dedupe, the epic gate that holds
 * every issue, and the sub-PR DAG's ready set. Moving them into code is only worth it if
 * they're actually checkable — so this runs each script for real with the harness hooks
 * stubbed, and asserts the decisions.
 *
 * No agents are spawned, nothing is dispatched, no network or git access. Fast enough to run
 * on every edit to either script.
 *
 *   node .agents/workflows/verify.mjs
 *
 * ## The harness contract these stubs mirror
 *
 * Workflow scripts are executed by Claude Code's **Workflow tool**, not by node. What it
 * provides — and what `run()` below reproduces — is:
 *
 *   - `agent(prompt, opts)` → the sub-agent's result. With `opts.schema` (JSON Schema) the
 *     agent is forced into structured output and the validated object is returned; without
 *     one, its final text. Returns `null` if the agent dies or is skipped.
 *     `opts`: `label` · `phase` · `schema` · `agentType` · `model` · `effort` · `isolation`.
 *   - `parallel(thunks)` → `Promise<any[]>`, a barrier. A thunk that throws resolves to
 *     `null`; **the call itself never rejects**, so results need `.filter(Boolean)`.
 *   - `pipeline(items, ...stages)` → each item runs every stage independently, no barrier
 *     between stages. A stage that throws drops that item to `null`.
 *   - `log(msg)` / `phase(title)` → progress output; `phase` titles must match `meta.phases`.
 *   - `args` → the value passed as the tool's `args`, verbatim. `budget` → the turn's token
 *     target. `workflow(name, args)` → run another workflow inline (one level only).
 *   - The script body is wrapped in an async function, so a top-level `return` is its result,
 *     and `export const meta` is hoisted out. No imports, no filesystem, no `Date.now()`.
 *
 * `budget` and `workflow` are injected here even though neither script uses them today —
 * this function IS the contract's local documentation, so it mirrors the whole surface rather
 * than only the parts currently exercised. Passing tests prove consistency with this mirror;
 * they do not prove the mirror matches the harness. See `docs/contributing/orchestration.md`
 * → "The workflow-script contract".
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * Run a workflow script the way the harness does: `export const meta` becomes a local, and
 * the body runs inside an async function so its top-level `return` is the script's result.
 *
 * @param {string} name script filename under this directory
 * @param {object} opts `args` for the script and `respond(prompt, opts)` for each agent() call
 * @returns {Promise<{result: unknown, calls: object[], logs: string[], phases: string[], meta: object}>}
 */
async function run(name, { args, respond }) {
  // Hoist `meta` out the way the harness does, and capture it as the declaration executes —
  // no second parse of the source, so reformatting the object literal can't break this.
  const capture = {}
  const src = readFileSync(join(HERE, name), 'utf8').replace(/^export const meta\s*=/m, 'const meta = capture.meta =')

  const calls = []
  const logs = []
  const phases = []

  const agent = async (prompt, opts = {}) => {
    calls.push({ prompt, ...opts })
    return respond(prompt, opts)
  }
  // Mirror the documented semantics: a thunk that throws resolves to null, the call never rejects.
  const parallel = (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null)))
  // Each item runs every stage independently; a stage that throws drops that item to null.
  const pipeline = (items, ...stages) =>
    Promise.all(
      items.map(async (item, i) => {
        try {
          let acc = item
          for (const stage of stages) acc = await stage(acc, item, i)
          return acc
        } catch {
          return null
        }
      }),
    )
  const log = (m) => logs.push(m)
  const phase = (t) => phases.push(t)
  const budget = { total: null, spent: () => 0, remaining: () => Infinity }
  const workflow = () => {
    throw new Error('nested workflow() not expected in these scripts')
  }

  const body = new Function(
    'agent',
    'parallel',
    'pipeline',
    'log',
    'phase',
    'args',
    'budget',
    'workflow',
    'capture',
    `return (async () => {\n${src}\n})()`,
  )

  const result = await body(agent, parallel, pipeline, log, phase, args, budget, workflow, capture)

  return { result, calls, logs, phases, meta: capture.meta }
}

const labels = (calls, prefix) => calls.filter((c) => (c.label || '').startsWith(prefix)).map((c) => c.label)
const workerLabels = (calls) => calls.filter((c) => c.agentType === 'issue-worker').map((c) => c.label)

/**
 * Load a script's PURE RULES region — everything between the two banner comments — and return
 * the functions it declares, so they can be driven over their whole input space rather than at
 * hand-picked examples.
 *
 * This exists because six rounds of example-based review kept finding the same shape of defect:
 * a state combination nobody thought to write a case for, which stalls the lifecycle or silently
 * consumes work. Examples catch what you imagined; enumeration catches what you didn't. The
 * region boundary is the seam the scripts already label pure, so this needs no test hooks in
 * them.
 */
function loadRules(name, names) {
  const src = readFileSync(join(HERE, name), 'utf8')
  const start = src.indexOf('// Rules (pure')
  const end = src.indexOf('// Agent result schemas')
  assert.ok(start > 0 && end > start, `${name}: could not locate the pure rules region`)
  const region = src.slice(start, end)
  return new Function(`${region}\n; return { ${names.join(', ')} }`)()
}

/** Every combination of the given field values — the input space, not a sample of it. */
function product(spec) {
  const keys = Object.keys(spec)
  return keys.reduce((acc, k) => acc.flatMap((base) => spec[k].map((v) => ({ ...base, [k]: v }))), [{}])
}

// ---------------------------------------------------------------------------
// Shared stubs
// ---------------------------------------------------------------------------

/** Build an epic-wake responder from per-issue fresh PR state and per-issue worker results. */
function epicResponder({ approved = true, epicReviewEvents = false, fresh = {}, worker = {}, poc = {}, fold = {}, nulls = [] } = {}) {
  return (prompt, opts) => {
    const label = opts.label || ''
    // `nulls` names labels whose agent "died" — the harness returns null for those.
    if (nulls.includes(label)) return null
    if (label === 'gate:epic') {
      return { approved, approver: approved ? 'jake' : null, headSha: 'abc', newReviewEvents: epicReviewEvents, latestActivityAt: '2026-07-05T00:00:00Z' }
    }
    if (label === 'fold:epic') return { roundsSpent: 1, aboveBar: false, folded: 'tightened the objective', fanOut: [], ...fold }
    if (label === 'route:epic-notes') return { notes: [] }
    if (label === 'linear:epic-children') return { issues: Object.keys(fresh).map((id) => ({ id, state: 'In Spec Review', blockedBy: [] })) }
    if (label.startsWith('refresh:')) {
      const id = label.slice('refresh:'.length)
      return { issueId: id, ...(fresh[id] || { phase: 'NEEDS_SPEC' }) }
    }
    if (label.startsWith('poc:')) return { claim: 'c', verdict: 'CONFIRMED', evidence: 'ran it', ...poc }
    const id = label.split(':')[1]
    return { issueId: id, phase: 'AWAITING_SPEC_APPROVAL', ...(worker[id] || {}) }
  }
}

const row = (id, over = {}) => ({ id, phase: 'NEEDS_SPEC', specReviewRounds: 0, specLevelFound: false, ...over })

// ---------------------------------------------------------------------------
// epic-wake
// ---------------------------------------------------------------------------

const epicArgs = (over = {}) => ({
  epic: { issueId: 'FIX-1', name: 'thing', branch: 'epic/thing', prNumber: 100 },
  cap: 3,
  issues: [],
  settleRequests: [],
  ...over,
})

const checks = []
const check = (name, fn) => checks.push({ name, fn })

check('epic gate unmet holds every issue and dispatches no worker', async () => {
  const { result, calls, logs } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2'), row('FIX-3')] }),
    respond: epicResponder({ approved: false, fresh: { 'FIX-2': { phase: 'NEEDS_SPEC' }, 'FIX-3': { phase: 'NEEDS_SPEC' } } }),
  })
  assert.equal(result.epicApproved, false)
  assert.deepEqual(result.gates, [{ kind: 'epic-objective', pr: 100 }])
  assert.deepEqual(workerLabels(calls), [], 'no issue-worker may be dispatched before the objective gate')
  assert.deepEqual(result.held, ['FIX-2', 'FIX-3'])
  assert.match(logs.join('\n'), /Epic objective not signed off — holding 2 issue\(s\)/)
})

check('epic-PR review still folds while the objective is unapproved', async () => {
  // The gate holds the sub-issues, not the epic-spec's own review — blocking the fold would
  // deadlock the very gate it is waiting on, since folding is how the objective gets revised.
  const { result, calls, logs } = await run('epic-wake.js', {
    args: epicArgs({ epic: { issueId: 'FIX-1', branch: 'epic/t', prNumber: 100, reviewRounds: 0 }, issues: [row('FIX-2')] }),
    respond: epicResponder({ approved: false, epicReviewEvents: true, fresh: { 'FIX-2': { phase: 'NEEDS_SPEC' } } }),
  })
  assert.deepEqual(labels(calls, 'fold:epic'), ['fold:epic'], 'the epic fold must run during AWAITING_OBJECTIVE')
  assert.deepEqual(workerLabels(calls), [], 'but no sub-issue advances')
  assert.equal(result.epic.reviewRounds, 1)
  assert.match(logs.join('\n'), /still folding epic-PR review so the objective can be revised/)
})

check('an issue with an open blocked-by relation is tracked, not dispatched', async () => {
  const { result, calls, logs } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2'), row('FIX-3')] }),
    respond: (prompt, opts) => {
      const label = opts.label || ''
      if (label === 'gate:epic') return { approved: true, headSha: 'abc', newReviewEvents: false }
      if (label === 'linear:epic-children') {
        return {
          issues: [
            { id: 'FIX-2', state: 'Todo', blockedBy: ['FIX-9'] },
            { id: 'FIX-3', state: 'Todo', blockedBy: [] },
          ],
        }
      }
      if (label.startsWith('refresh:')) return { issueId: label.slice(8), phase: 'NEEDS_SPEC' }
      return { issueId: label.split(':')[1], phase: 'AWAITING_SPEC_APPROVAL' }
    },
  })
  assert.deepEqual(workerLabels(calls), ['spec:FIX-3'], 'the blocked issue must not run concurrently with its blocker')
  assert.deepEqual(result.blocked, [{ issueId: 'FIX-2', blockedBy: ['FIX-9'] }])
  assert.match(logs.join('\n'), /FIX-2: blocked by FIX-9 — tracked, not admitted to the active set/)
})

check('per-issue activity cursors are passed to the scout and advanced', async () => {
  // Without this the same spec-PR feedback reads as new on every wake: it burns a review round
  // per wake and dispatches duplicate PR-feedback workers.
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7, lastSeenActivityAt: '2026-07-01T00:00:00Z', lastSeenSha: 'sha1' })],
    }),
    respond: epicResponder({
      fresh: {
        'FIX-2': {
          phase: 'AWAITING_SPEC_APPROVAL',
          specApproved: false,
          newSpecReviewEvents: false,
          specPr: 7,
          latestActivityAt: '2026-07-02T00:00:00Z',
          headSha: 'sha2',
        },
      },
    }),
  })
  const refresh = calls.find((c) => c.label === 'refresh:FIX-2')
  assert.match(refresh.prompt, /Last seen: activity at 2026-07-01T00:00:00Z, head sha1/)
  assert.match(refresh.prompt, /strictly newer than that timestamp/)
  assert.equal(result.issues[0].lastSeenActivityAt, '2026-07-02T00:00:00Z', 'the cursor advances to what was observed')
  assert.equal(result.issues[0].lastSeenSha, 'sha2')
  assert.deepEqual(workerLabels(calls), [], 'already-handled feedback is not a pending action')
})

check('a deferred row keeps its cursor so the deferred feedback survives', async () => {
  // Advancing a deferred row's cursor would erase the very feedback just logged as "deferred
  // to the next wake" — it would read as already-handled and never run.
  const { result, logs } = await run('epic-wake.js', {
    args: epicArgs({
      cap: 1,
      issues: [
        row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 8, lastSeenActivityAt: 'old', lastSeenSha: 'old' }),
        row('FIX-3', { phase: 'PR_FEEDBACK', implPr: 9, lastSeenActivityAt: 'old', lastSeenSha: 'old' }),
      ],
    }),
    respond: epicResponder({
      fresh: {
        'FIX-2': { phase: 'PR_FEEDBACK', newPrEvents: true, implPr: 8, latestActivityAt: 'new', headSha: 'newsha' },
        'FIX-3': { phase: 'PR_FEEDBACK', newPrEvents: true, implPr: 9, latestActivityAt: 'new', headSha: 'newsha' },
      },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 8 } },
    }),
  })
  assert.deepEqual(result.deferred, ['FIX-3'])
  const dispatched = result.issues.find((r) => r.id === 'FIX-2')
  const deferred = result.issues.find((r) => r.id === 'FIX-3')
  assert.equal(dispatched.lastSeenActivityAt, 'new', 'the handled row advances')
  assert.equal(deferred.lastSeenActivityAt, 'old', 'the deferred row must NOT advance')
  assert.match(logs.join('\n'), /deferring FIX-3/)
})

check('a row whose worker died keeps its cursor for retry', async () => {
  const { result } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 8, lastSeenActivityAt: 'old' })] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', newPrEvents: true, implPr: 8, latestActivityAt: 'new', headSha: 'newsha' } },
      nulls: ['pr-feedback:FIX-2'],
    }),
  })
  assert.equal(result.issues[0].lastSeenActivityAt, 'old', 'a dead worker consumed nothing')
})

check('a carried blockedBy survives a failed Linear refresh', async () => {
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { blockedBy: ['FIX-9'] })] }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'NEEDS_SPEC' } }, nulls: ['linear:epic-children'] }),
  })
  assert.deepEqual(workerLabels(calls), [], 'a dead Linear scout must not un-block an issue')
  assert.deepEqual(result.blocked, [{ issueId: 'FIX-2', blockedBy: ['FIX-9'] }])
})

check('a dead POC agent requeues the claim instead of inventing INCONCLUSIVE', async () => {
  const { result, logs } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [],
      settleRequests: [{ claim: 'c1', load: 'x', falsify: 'y', threads: 't', issueId: 'FIX-2' }],
    }),
    respond: epicResponder({ nulls: ['poc:c1'] }),
  })
  assert.deepEqual(result.verdicts, [], 'no fabricated verdict')
  assert.equal(result.settleRequests.length, 1, 'the claim is requeued for retry')
  assert.match(logs.join('\n'), /returned nothing \(agent died or skipped\) — requeued, NOT recorded as INCONCLUSIVE/)
})

check('a verdict carries claim and evidence, not just the enum', async () => {
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'PR_FEEDBACK' })],
      settleRequests: [{ claim: 'routers compose', load: 'x', falsify: 'y', threads: 'PR#7', issueId: 'FIX-2' }],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', newPrEvents: false } },
      poc: { claim: 'routers compose', verdict: 'REFUTED', evidence: 'fsdev run shows it throws' },
    }),
  })
  const v = result.issues[0].verdicts[0]
  assert.equal(v.verdict, 'REFUTED')
  assert.equal(v.evidence, 'fsdev run shows it throws', 'the folding worker needs the evidence to reply with it')
  assert.equal(v.claim, 'routers compose')
  assert.equal(v.threads, 'PR#7')
  assert.deepEqual(labels(calls, 'poc:'), ['poc:routers compose'])
})

check('a verdict whose folding worker died is retained, not consumed', async () => {
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7, verdicts: [{ claim: 'c', verdict: 'REFUTED', evidence: 'e' }] })],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7 } },
      nulls: ['apply-verdict:FIX-2'],
    }),
  })
  assert.equal(result.issues[0].verdicts[0].verdict, 'REFUTED', 'a dead folder must not lose the POC result')
})

check('an epic-level verdict lands on the epic and folds outside the budget', async () => {
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({
      epic: { issueId: 'FIX-1', branch: 'epic/t', prNumber: 100, reviewRounds: 2, aboveBarFound: false },
      issues: [],
      settleRequests: [{ claim: 'cross-cutting thing', load: 'x', falsify: 'y', threads: 't', issueId: 'FIX-1' }],
    }),
    respond: epicResponder({ poc: { claim: 'cross-cutting thing', verdict: 'CONFIRMED', evidence: 'ran it' } }),
  })
  // The verdict lands on the epic this wake (there is no epic row to carry it), and next wake folds it.
  assert.equal(result.epic.verdicts[0].verdict, 'CONFIRMED')

  const next = await run('epic-wake.js', {
    args: epicArgs({ epic: { ...result.epic, prNumber: 100, branch: 'epic/t', issueId: 'FIX-1' }, issues: [] }),
    respond: epicResponder({ epicReviewEvents: false }),
  })
  assert.deepEqual(labels(next.calls, 'fold:epic'), ['fold:epic'], 'folded even at budget — evidence is not another opinion')
  assert.match(next.calls[next.calls.length - 1].prompt, /A POC settled 1 cross-cutting claim/)
  assert.match(next.calls[next.calls.length - 1].prompt, /outside the review budget/)
  assert.deepEqual(next.result.epic.verdicts, [], 'cleared once the fold returned')
})

check('the epic activity cursor is a timestamp, not just the head SHA', async () => {
  // A comment never moves the head SHA, so a SHA-only cursor can't identify a folded review.
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({
      epic: { issueId: 'FIX-1', branch: 'epic/t', prNumber: 100, reviewRounds: 0, lastSeenActivityAt: '2026-07-01T00:00:00Z', lastSeenSha: 'abc' },
      issues: [],
    }),
    respond: epicResponder({ epicReviewEvents: true }),
  })
  assert.match(calls[0].prompt, /last seen activity at 2026-07-01T00:00:00Z/)
  assert.match(calls[0].prompt, /a comment never changes the head SHA/)
  assert.equal(result.epic.lastSeenActivityAt, '2026-07-05T00:00:00Z', 'the timestamp cursor advances')
})

check('an epic fold that died keeps its cursor for retry', async () => {
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      epic: { issueId: 'FIX-1', branch: 'epic/t', prNumber: 100, reviewRounds: 0, lastSeenActivityAt: 'old' },
      issues: [],
    }),
    respond: epicResponder({ epicReviewEvents: true, nulls: ['fold:epic'] }),
  })
  assert.equal(result.epic.lastSeenActivityAt, 'old', 'the same feedback must still be foldable next wake')
  assert.equal(result.epic.reviewRounds, 0, 'and no round was spent')
})

check('the folding prompt serializes the verdict instead of stringifying the object', async () => {
  const { calls } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'AWAITING_SPEC_APPROVAL',
          specPr: 7,
          verdicts: [{ claim: 'routers compose', verdict: 'REFUTED', evidence: 'it throws', threads: 'PR#7' }],
        }),
      ],
    }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7 } } }),
  })
  const p = calls.find((c) => c.label === 'apply-verdict:FIX-2').prompt
  assert.ok(!p.includes('[object Object]'), 'the verdict must be serialized field by field')
  assert.match(p, /claim:    routers compose/)
  assert.match(p, /evidence: it throws/)
  assert.match(p, /threads:  PR#7/)
})

check('two verdicts on one issue both survive to be folded', async () => {
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'PR_FEEDBACK' })],
      settleRequests: [
        { claim: 'claim one', load: 'x', falsify: 'y', threads: 't', issueId: 'FIX-2' },
        { claim: 'claim two', load: 'x', falsify: 'y', threads: 't', issueId: 'FIX-2' },
      ],
    }),
    respond: (prompt, opts) => {
      const label = opts.label || ''
      if (label === 'gate:epic') return { approved: true, headSha: 'abc', newReviewEvents: false }
      if (label === 'linear:epic-children') return { issues: [{ id: 'FIX-2', state: 'x', blockedBy: [] }] }
      if (label.startsWith('refresh:')) return { issueId: 'FIX-2', phase: 'PR_FEEDBACK', newPrEvents: false }
      if (label === 'poc:claim one') return { claim: 'claim one', verdict: 'CONFIRMED', evidence: 'a' }
      if (label === 'poc:claim two') return { claim: 'claim two', verdict: 'REFUTED', evidence: 'b' }
      return { issueId: 'FIX-2', phase: 'PR_FEEDBACK' }
    },
  })
  assert.equal(labels(calls, 'poc:').length, 2)
  assert.deepEqual(
    result.issues[0].verdicts.map((v) => v.verdict).sort(),
    ['CONFIRMED', 'REFUTED'],
    'a map keyed by issue would have dropped one while consuming both requests',
  )
})

check('a requeued claim keeps every issue it was argued on', async () => {
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      cap: 1, // the lone issue worker takes the slot, so the claim must queue
      issues: [row('FIX-2')],
      settleRequests: [{ claim: 'c1', load: 'x', falsify: 'y', threads: 't', issueId: 'FIX-2', issues: ['FIX-2', 'FIX-3'] }],
    }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'NEEDS_SPEC' } } }),
  })
  assert.deepEqual(result.settleRequests[0].issues, ['FIX-2', 'FIX-3'], 'the accumulated fan-out must survive requeueing')
})

check('a present Linear row clears a resolved blocker', async () => {
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { blockedBy: ['FIX-9'] })] }),
    respond: (prompt, opts) => {
      const label = opts.label || ''
      if (label === 'gate:epic') return { approved: true, headSha: 'abc', newReviewEvents: false }
      // Present row, `blockedBy` omitted — schema-valid, and means "no blockers".
      if (label === 'linear:epic-children') return { issues: [{ id: 'FIX-2', state: 'Todo' }] }
      if (label.startsWith('refresh:')) return { issueId: 'FIX-2', phase: 'NEEDS_SPEC' }
      return { issueId: 'FIX-2', phase: 'AWAITING_SPEC_APPROVAL' }
    },
  })
  assert.deepEqual(result.blocked, [], 'a merged blocker must actually un-block the issue')
  assert.deepEqual(workerLabels(calls), ['spec:FIX-2'])
})

check('a durable epic approval survives a dead gate scout', async () => {
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({
      epic: { issueId: 'FIX-1', branch: 'epic/t', prNumber: 100, approved: true },
      issues: [row('FIX-2')],
    }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'NEEDS_SPEC' } }, nulls: ['gate:epic'] }),
  })
  assert.equal(result.epicApproved, true, 'infrastructure failure must not re-lock an approved epic')
  assert.deepEqual(workerLabels(calls), ['spec:FIX-2'])
  assert.equal(result.epic.approved, true, 'and the approval is returned for persistence')
})

check('a live scan still revokes an approval that a push invalidated', async () => {
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({ epic: { issueId: 'FIX-1', branch: 'epic/t', prNumber: 100, approved: true }, issues: [row('FIX-2')] }),
    respond: epicResponder({ approved: false, fresh: { 'FIX-2': { phase: 'NEEDS_SPEC' } } }),
  })
  assert.equal(result.epicApproved, false, 'a live scan is authoritative in both directions')
  assert.deepEqual(workerLabels(calls), [])
})

check('the functional epic head refreshes so workers align to the current objective', async () => {
  const { result } = await run('epic-wake.js', {
    args: epicArgs({ epic: { issueId: 'FIX-1', branch: 'epic/t', prNumber: 100, headSha: 'stale' }, issues: [] }),
    respond: epicResponder(),
  })
  assert.equal(result.epic.headSha, 'abc', 'a stale head aligns specs to a superseded objective')
})

check('converged epic feedback is actually routed, not just claimed', async () => {
  const { result, calls, logs } = await run('epic-wake.js', {
    args: epicArgs({
      epic: { issueId: 'FIX-1', branch: 'epic/t', prNumber: 100, reviewRounds: 2, aboveBarFound: false, lastSeenActivityAt: 'old' },
      issues: [],
    }),
    respond: (prompt, opts) => {
      const label = opts.label || ''
      if (label === 'gate:epic') return { approved: true, headSha: 'abc', newReviewEvents: true, latestActivityAt: 'new' }
      if (label === 'linear:epic-children') return { issues: [] }
      if (label === 'route:epic-notes') return { notes: [{ summary: 'rename the helper', fanOut: ['FIX-2'] }] }
      return null
    },
  })
  assert.deepEqual(labels(calls, 'fold:epic'), [], 'a converged epic-spec is not folded')
  assert.deepEqual(labels(calls, 'route:epic-notes'), ['route:epic-notes'], 'but the feedback IS read for routing')
  assert.equal(calls.find((c) => c.label === 'route:epic-notes').agentType, 'scout', 'cheap read, no worktree')
  assert.deepEqual(result.epicNotes, [{ summary: 'rename the helper', fanOut: ['FIX-2'] }])
  assert.equal(result.epic.reviewRounds, 2, 'routing costs no round')
  assert.equal(result.epic.lastSeenActivityAt, 'new', 'and the routed feedback is consumed')
  assert.match(logs.join('\n'), /not folding review feedback; reading it to route as implementer notes/)
})

check('a queued or newly-raised claim is still disclosed at the approval gate', async () => {
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      cap: 1,
      issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7 }), row('FIX-3', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 })],
      // Two claims, cap 1 — one dispatches, one queues. Both must be disclosed.
      settleRequests: [
        { claim: 'claim A', load: 'x', falsify: 'y', threads: 't', issueId: 'FIX-2' },
        { claim: 'claim B', load: 'x', falsify: 'y', threads: 't', issueId: 'FIX-3' },
      ],
    }),
    respond: epicResponder({
      fresh: {
        'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specApproved: false, specPr: 7 },
        'FIX-3': { phase: 'AWAITING_SPEC_APPROVAL', specApproved: false, specPr: 8 },
      },
    }),
  })
  const gates = result.gates.filter((g) => g.kind === 'spec-approval')
  assert.deepEqual(
    gates.map((g) => g.settlingInFlight),
    ['claim A', 'claim B'],
    'telling the user nothing is in flight while a premise is contested is the failure this prevents',
  )
})

check('a row carrying an unresolved human blocker is parked, not re-dispatched', async () => {
  // A worker that escalated a decision is waiting on the HUMAN. Re-dispatching on an unrelated
  // event either retries the dead end or pushes the worker to invent the answer.
  const { calls } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9, blocker: 'needs a call on the store shape' })] }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', newPrEvents: true, implPr: 9 } } }),
  })
  assert.deepEqual(workerLabels(calls), [], 'the escalated decision is the human’s, so nothing re-dispatches')
})

check('a cleared blocker lets the issue resume', async () => {
  const { calls } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9, blocker: null })] }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', newPrEvents: true, implPr: 9 } } }),
  })
  assert.deepEqual(workerLabels(calls), ['pr-feedback:FIX-2'])
})

check('a non-review worker cannot revoke the authorized third round', async () => {
  // `specLevelFound` is optional in WORKER_SCHEMA, so an apply-verdict fold omits it. Coercing
  // that absence to false would silently suppress the round a real review round authorized.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'AWAITING_SPEC_APPROVAL',
          specPr: 7,
          specReviewRounds: 2,
          specLevelFound: true,
          verdicts: [{ claim: 'c', verdict: 'REFUTED', evidence: 'e' }],
        }),
      ],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7 } },
      // An apply-verdict worker: no specLevelFound in its response.
      worker: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7 } },
    }),
  })
  assert.equal(result.issues[0].specLevelFound, true, 'the flag survives a worker that never reported it')
})

check('a newly discovered epic child enters the table at NEEDS_SPEC', async () => {
  const { result, calls, logs } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2')] }),
    respond: (prompt, opts) => {
      const label = opts.label || ''
      if (label === 'gate:epic') return { approved: true, headSha: 'abc', newReviewEvents: false }
      // issue-manager parented FIX-7 under the epic mid-run; the Linear scan is where it appears.
      if (label === 'linear:epic-children') {
        return {
          issues: [
            { id: 'FIX-2', state: 'Todo', blockedBy: [] },
            { id: 'FIX-7', state: 'Todo', blockedBy: [] },
          ],
        }
      }
      if (label.startsWith('refresh:')) return { issueId: label.slice(8), phase: 'NEEDS_SPEC' }
      return { issueId: label.split(':')[1], phase: 'AWAITING_SPEC_APPROVAL' }
    },
  })
  assert.ok(
    result.issues.some((r) => r.id === 'FIX-7' && r.discovered),
    'a table built only from carried rows would make discovered work invisible',
  )
  assert.deepEqual(workerLabels(calls).sort(), ['spec:FIX-2', 'spec:FIX-7'])
  assert.match(logs.join('\n'), /Discovered 1 new sub-issue\(s\) under the epic: FIX-7/)
})

check('the epic itself is never added as one of its own children', async () => {
  const { result } = await run('epic-wake.js', {
    args: epicArgs({ issues: [] }),
    respond: (prompt, opts) => {
      const label = opts.label || ''
      if (label === 'gate:epic') return { approved: true, headSha: 'abc', newReviewEvents: false }
      if (label === 'linear:epic-children') return { issues: [{ id: 'FIX-1', state: 'Todo', blockedBy: [] }] }
      return null
    },
  })
  assert.deepEqual(result.issues, [], 'the epic parent is not a work item')
})

check('a converged epic folds only the verdict while routing ordinary feedback', async () => {
  // The evidence exemption covers the verdict. Folding the outstanding review feedback alongside
  // it would smuggle in a full extra review round.
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({
      epic: {
        issueId: 'FIX-1',
        branch: 'epic/t',
        prNumber: 100,
        reviewRounds: 2,
        aboveBarFound: false,
        verdicts: [{ claim: 'c', verdict: 'CONFIRMED', evidence: 'e' }],
      },
      issues: [],
    }),
    respond: (prompt, opts) => {
      const label = opts.label || ''
      if (label === 'gate:epic') return { approved: true, headSha: 'abc', newReviewEvents: true, latestActivityAt: 'new' }
      if (label === 'linear:epic-children') return { issues: [] }
      if (label === 'fold:epic') return { roundsSpent: 0, aboveBar: false, folded: 'recorded the verdict', fanOut: [] }
      if (label === 'route:epic-notes') return { notes: [{ summary: 'rename the helper', fanOut: ['FIX-2'] }] }
      return null
    },
  })
  assert.deepEqual(labels(calls, 'fold:epic'), ['fold:epic'], 'the verdict still folds')
  assert.deepEqual(labels(calls, 'route:epic-notes'), ['route:epic-notes'], 'and the ordinary feedback still routes')
  const foldPrompt = calls.find((c) => c.label === 'fold:epic').prompt
  assert.match(foldPrompt, /Fold the verdict above and NOTHING ELSE/)
  assert.match(foldPrompt, /report roundsSpent: 0/)
  assert.equal(result.epic.reviewRounds, 2, 'the exemption buys no extra review round')
  assert.deepEqual(result.epicNotes, [{ summary: 'rename the helper', fanOut: ['FIX-2'] }])
})

check('an apply-verdict does not consume concurrent review activity', async () => {
  // apply-verdict outranks spec-review, and its prompt carries no review content — counting it
  // as consumption would drop the concurrent feedback permanently.
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'AWAITING_SPEC_APPROVAL',
          specPr: 7,
          lastSeenActivityAt: 'old',
          verdicts: [{ claim: 'c', verdict: 'REFUTED', evidence: 'e' }],
        }),
      ],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7, newSpecReviewEvents: true, latestActivityAt: 'new' } },
      worker: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7 } },
    }),
  })
  assert.deepEqual(workerLabels(calls), ['apply-verdict:FIX-2'])
  assert.equal(result.issues[0].lastSeenActivityAt, 'old', 'the review feedback is still owed a round')
})

check('workers align to the head the gate scan just observed', async () => {
  const { calls } = await run('epic-wake.js', {
    args: epicArgs({ epic: { issueId: 'FIX-1', branch: 'epic/t', prNumber: 100, headSha: 'stale' }, issues: [row('FIX-2')] }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'NEEDS_SPEC' } } }),
  })
  const p = calls.find((c) => c.label === 'spec:FIX-2').prompt
  assert.match(p, /head abc/, 'the wake that releases the spec must pass the fresh head, not the pre-fold one')
  assert.ok(!p.includes('stale'))
})

check('the epic cursor holds when requested note routing fails', async () => {
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      epic: {
        issueId: 'FIX-1',
        branch: 'epic/t',
        prNumber: 100,
        reviewRounds: 2,
        lastSeenActivityAt: 'old',
        verdicts: [{ claim: 'c', verdict: 'CONFIRMED', evidence: 'e' }],
      },
      issues: [],
    }),
    // The verdict fold returns; the notes scout dies. The ordinary feedback was never routed.
    respond: epicResponder({ epicReviewEvents: true, nulls: ['route:epic-notes'] }),
  })
  assert.equal(result.epic.lastSeenActivityAt, 'old', 'unrouted feedback must not be consumed')
})

check('a verdict-only fold is not told to fold absent review feedback', async () => {
  const { calls } = await run('epic-wake.js', {
    args: epicArgs({
      epic: {
        issueId: 'FIX-1',
        branch: 'epic/t',
        prNumber: 100,
        reviewRounds: 0,
        verdicts: [{ claim: 'c', verdict: 'CONFIRMED', evidence: 'e' }],
      },
      issues: [],
    }),
    // Budget remains, but there is NO new epic review activity.
    respond: epicResponder({ epicReviewEvents: false }),
  })
  const p = calls.find((c) => c.label === 'fold:epic').prompt
  assert.match(p, /Fold the verdict above and NOTHING ELSE/)
  assert.match(p, /report roundsSpent: 0/)
  assert.ok(!/Triage against the bar first/.test(p), 'no re-reading of already-consumed comments')
})

check('the epic review cursor advances to the scanned head', async () => {
  // Otherwise the same epic-PR event re-triggers a fold every wake, forever.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({ epic: { issueId: 'FIX-1', branch: 'epic/t', prNumber: 100, reviewRounds: 0, lastSeenSha: 'old' }, issues: [] }),
    respond: epicResponder({ epicReviewEvents: true }),
  })
  assert.equal(result.epic.lastSeenSha, 'abc', 'the cursor must move off the SHA we just scanned')
})

check('spec at budget with no spec-level finding converges instead of dispatching', async () => {
  const { result, calls, logs } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specReviewRounds: 2, specLevelFound: false })] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specApproved: false, newSpecReviewEvents: true, specPr: 7 } },
    }),
  })
  assert.deepEqual(workerLabels(calls), [], 'a spec at budget is not a pending action')
  assert.deepEqual(result.converged, ['FIX-2'])
  assert.match(logs.join('\n'), /FIX-2: spec converged \(2 rounds spent\)/)
})

check('the conditional third round IS dispatched, and says so', async () => {
  const { calls, logs } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specReviewRounds: 2, specLevelFound: true })] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specApproved: false, newSpecReviewEvents: true, specPr: 7 } },
    }),
  })
  assert.deepEqual(workerLabels(calls), ['spec-review:FIX-2'])
  assert.match(logs.join('\n'), /authorized third review round/)
})

check('a fourth round is refused even after a third found something', async () => {
  const { calls } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specReviewRounds: 3, specLevelFound: true })] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specApproved: false, newSpecReviewEvents: true, specPr: 7 } },
    }),
  })
  assert.deepEqual(workerLabels(calls), [], 'the third round is authorized once, not repeatedly')
})

check('rounds accumulate from what the worker reports spending, not per event', async () => {
  const { result } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specReviewRounds: 1 })] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specApproved: false, newSpecReviewEvents: true, specPr: 7 } },
      // A batch of pure factual corrections: dispatched, but costs zero rounds by rule.
      worker: { 'FIX-2': { specReviewRoundsSpent: 0, specLevelFound: false } },
    }),
  })
  assert.equal(result.issues[0].specReviewRounds, 1, 'a zero-round batch must not consume budget')
})

check('a satisfied spec gate chains straight into implementation', async () => {
  const { calls } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7 })] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specApproved: true, specPr: 7 } },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9 } },
    }),
  })
  assert.deepEqual(workerLabels(calls), ['implement:FIX-2'])
  assert.match(calls.find((c) => c.label === 'implement:FIX-2').prompt, /satisfied gate is NOT a wait/)
})

check('the cap bounds dispatch and names what it deferred', async () => {
  const ids = ['FIX-2', 'FIX-3', 'FIX-4', 'FIX-5']
  const { result, calls, logs } = await run('epic-wake.js', {
    args: epicArgs({ cap: 2, issues: ids.map((id) => row(id)) }),
    respond: epicResponder({ fresh: Object.fromEntries(ids.map((id) => [id, { phase: 'NEEDS_SPEC' }])) }),
  })
  assert.equal(workerLabels(calls).length, 2)
  assert.deepEqual(result.deferred, ['FIX-4', 'FIX-5'])
  assert.match(logs.join('\n'), /Cap 2 reached — deferring FIX-4, FIX-5/)
})

check('one claim argued on two issues is one POC fanned to both', async () => {
  const { result, calls, logs } = await run('epic-wake.js', {
    args: epicArgs({
      cap: 3,
      issues: [row('FIX-2', { phase: 'PR_FEEDBACK' }), row('FIX-3', { phase: 'PR_FEEDBACK' })],
      settleRequests: [
        { claim: 'A router can compose with a sequencer', load: 'x', falsify: 'y', threads: 't', issueId: 'FIX-2' },
        { claim: '  a ROUTER can   compose with a sequencer ', load: 'x', falsify: 'y', threads: 't', issueId: 'FIX-3' },
      ],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', newPrEvents: false }, 'FIX-3': { phase: 'PR_FEEDBACK', newPrEvents: false } },
    }),
  })
  const pocs = labels(calls, 'poc:')
  assert.equal(pocs.length, 1, 'the same claim must settle once')
  assert.deepEqual(result.verdicts[0].issues, ['FIX-2', 'FIX-3'], 'the verdict fans out to both issues')
  assert.match(logs.join('\n'), /Deduped 2 settlement request\(s\) into 1 claim/)
  // The verdict has to land ON the rows — the request is consumed this wake, so a verdict only
  // in the return payload would be lost and the claim would never get folded.
  assert.deepEqual(
    result.issues.map((r) => r.verdicts.map((v) => v.verdict)),
    [['CONFIRMED'], ['CONFIRMED']],
    'both issues carry the verdict into the next wake',
  )
  assert.deepEqual(result.settleRequests, [], 'and the settled request is not re-queued')
})

check('a carried verdict is dispatched as apply-verdict, then cleared', async () => {
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7, verdicts: [{ claim: 'c', verdict: 'REFUTED', evidence: 'e' }] })],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specApproved: false, specPr: 7 } },
      worker: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7 } },
    }),
  })
  assert.deepEqual(workerLabels(calls), ['apply-verdict:FIX-2'])
  assert.match(calls.find((c) => c.label === 'apply-verdict:FIX-2').prompt, /verdict:  REFUTED/)
  assert.deepEqual(result.issues[0].verdicts, [], 'an applied verdict is consumed, not re-applied next wake')
})

check('settlements queue behind issue workers at the cap', async () => {
  const { result, calls, logs } = await run('epic-wake.js', {
    args: epicArgs({
      cap: 1,
      issues: [row('FIX-2')],
      settleRequests: [{ claim: 'c1', load: 'x', falsify: 'y', threads: 't', issueId: 'FIX-2' }],
    }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'NEEDS_SPEC' } } }),
  })
  assert.equal(workerLabels(calls).length, 1, 'the issue worker gets the slot')
  assert.deepEqual(labels(calls, 'poc:'), [], 'the POC waits rather than starving the worker')
  assert.equal(result.settleRequests.length, 1, 'and is carried to the next wake')
  assert.match(logs.join('\n'), /settlement\(s\) queued behind the issue workers/)
})

check('a settle request returned by a worker is carried, and an in-flight one is disclosed', async () => {
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7 }), row('FIX-3')],
      settleRequests: [{ claim: 'c1', load: 'x', falsify: 'y', threads: 't', issueId: 'FIX-2' }],
    }),
    respond: epicResponder({
      fresh: {
        'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specApproved: false, newSpecReviewEvents: true, specPr: 7 },
        'FIX-3': { phase: 'NEEDS_SPEC' },
      },
      worker: {
        'FIX-3': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8, settleRequested: { claim: 'c2', load: 'x', falsify: 'y', threads: 't' } },
      },
    }),
  })
  assert.ok(
    result.settleRequests.some((r) => r.claim === 'c2' && r.issueId === 'FIX-3'),
    "a worker's settle request is carried to the next wake",
  )
  const specGate = result.gates.find((g) => g.kind === 'spec-approval' && g.issueId === 'FIX-2')
  assert.equal(specGate.settlingInFlight, 'c1', 'an in-flight settlement is disclosed on the gate it affects')
})

check('the epic PR carries the same budget — folded while it allows', async () => {
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({ epic: { issueId: 'FIX-1', branch: 'epic/t', prNumber: 100, reviewRounds: 1 }, issues: [] }),
    respond: epicResponder({ epicReviewEvents: true, fold: { roundsSpent: 1, aboveBar: true, fanOut: [{ summary: 'rename it', issues: ['FIX-2'] }] } }),
  })
  assert.deepEqual(labels(calls, 'fold:epic'), ['fold:epic'])
  assert.equal(result.epic.reviewRounds, 2, 'adds only the rounds the folder reported spending')
  assert.equal(result.epic.aboveBarFound, true)
  assert.deepEqual(result.epicFold.fanOut, [{ summary: 'rename it', issues: ['FIX-2'] }])
})

check('the epic-spec converges too, and stops being folded', async () => {
  const { result, calls, logs } = await run('epic-wake.js', {
    args: epicArgs({ epic: { issueId: 'FIX-1', branch: 'epic/t', prNumber: 100, reviewRounds: 2, aboveBarFound: false }, issues: [] }),
    respond: epicResponder({ epicReviewEvents: true }),
  })
  assert.deepEqual(labels(calls, 'fold:epic'), [], 'a converged epic-spec is not folded again')
  assert.equal(result.epic.converged, true)
  assert.match(logs.join('\n'), /Epic-spec converged \(2 rounds spent\)/)
})

check('the epic fold queues behind issue workers at the cap', async () => {
  const { calls, logs } = await run('epic-wake.js', {
    args: epicArgs({ cap: 1, epic: { issueId: 'FIX-1', branch: 'epic/t', prNumber: 100, reviewRounds: 0 }, issues: [row('FIX-2')] }),
    respond: epicResponder({ epicReviewEvents: true, fresh: { 'FIX-2': { phase: 'NEEDS_SPEC' } } }),
  })
  assert.equal(workerLabels(calls).length, 1)
  assert.deepEqual(labels(calls, 'fold:epic'), [])
  assert.match(logs.join('\n'), /epic-spec fold queued behind the issue workers/)
})

check('a ready-to-merge issue surfaces a merge gate and is never merged here', async () => {
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9 })] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', newPrEvents: true, implPr: 9 } },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9, readyToMerge: true } },
    }),
  })
  assert.deepEqual(result.gates, [{ kind: 'merge', issueId: 'FIX-2', pr: 9 }])
  assert.equal(calls.filter((c) => /merge/i.test(c.prompt || '') && c.agentType === 'issue-worker').length, 0)
})

// ---------------------------------------------------------------------------
// issue-multi-pr
// ---------------------------------------------------------------------------

const node = (id, over = {}) => ({ id, dependsOn: [], status: 'pending', branch: null, pr: null, ...over })

const multiArgs = (over = {}) => ({ issueId: 'FIX-9', cap: 3, subPrs: [], assembledGoal: {}, ...over })

const multiResponder =
  ({
    build = {},
    goal = { passed: true, evidence: 'fsdev run: PASS' },
    gap = { issueFiled: 'FIX-99', ready: true },
    fix = { pr: 42 },
    nulls = [],
  } = {}) =>
  (prompt, opts) => {
    const label = opts.label || ''
    if (nulls.some((n) => label.startsWith(n))) return null
    if (label.startsWith('assembled-goal:')) return goal
    if (label.startsWith('assembled-gap:')) return gap
    if (label.startsWith('assembled-fix:')) return fix
    const id = label.split(':')[1]
    return { id, status: 'open', pr: 1, branch: `fix/FIX-9-${id}`, ...(build[id] || {}) }
  }

check('an independent sub-PR builds on fresh origin/main', async () => {
  const { calls } = await run('issue-multi-pr.js', {
    args: multiArgs({ subPrs: [node('a')] }),
    respond: multiResponder(),
  })
  assert.deepEqual(calls.map((c) => c.label), ['build:a'])
  assert.match(calls[0].prompt, /based on origin\/main/)
  assert.match(calls[0].prompt, /Fetch origin\/main first/)
  assert.equal(calls[0].isolation, 'worktree')
})

check('a dependent stacks on its open dependency so review can start', async () => {
  const { result, calls } = await run('issue-multi-pr.js', {
    args: multiArgs({ subPrs: [node('a', { status: 'open', branch: 'fix/FIX-9-a', pr: 1 }), node('b', { dependsOn: ['a'] })] }),
    respond: multiResponder(),
  })
  assert.deepEqual(calls.map((c) => c.label), ['build:b'])
  assert.match(calls[0].prompt, /based on fix\/FIX-9-a/)
  assert.match(calls[0].prompt, /stacking on an unmerged dependency/)
  // The worker response here deliberately omits `stackedOn` (the common case — it's optional).
  // The marker must come from the base the SCRIPT chose, or the later rebase never schedules
  // and the sub-PR keeps its dependency's commits in its own diff.
  assert.equal(result.subPrs.find((n) => n.id === 'b').stackedOn, 'fix/FIX-9-a')
})

check('a build on origin/main records no stack marker', async () => {
  const { result } = await run('issue-multi-pr.js', {
    args: multiArgs({ subPrs: [node('a')] }),
    respond: multiResponder(),
  })
  assert.equal(result.subPrs[0].stackedOn, null)
})

check('a dependent whose dependency is still pending is not ready', async () => {
  const { result, calls, logs } = await run('issue-multi-pr.js', {
    args: multiArgs({ subPrs: [node('a', { status: 'building' }), node('b', { dependsOn: ['a'] })] }),
    respond: multiResponder(),
  })
  assert.deepEqual(calls, [])
  assert.equal(result.done, false)
  assert.match(logs.join('\n'), /No sub-PR is ready — waiting on a\(building\), b\(pending\)/)
})

check('two open dependencies are waited on rather than stacked arbitrarily', async () => {
  const { calls } = await run('issue-multi-pr.js', {
    args: multiArgs({
      subPrs: [
        node('a', { status: 'open', branch: 'fix/FIX-9-a' }),
        node('b', { status: 'open', branch: 'fix/FIX-9-b' }),
        node('c', { dependsOn: ['a', 'b'] }),
      ],
    }),
    respond: multiResponder(),
  })
  assert.deepEqual(calls, [], 'stacking on one of two open deps would pick a base arbitrarily')
})

check('a merged + open dependency mix waits rather than stacking on an incomplete base', async () => {
  // C needs merged A and open B. B's branch may have been cut before A merged, so stacking on
  // it would build C without A's code at all.
  const { calls } = await run('issue-multi-pr.js', {
    args: multiArgs({
      subPrs: [
        node('a', { status: 'merged', branch: 'fix/FIX-9-a' }),
        node('b', { status: 'open', branch: 'fix/FIX-9-b' }),
        node('c', { dependsOn: ['a', 'b'] }),
      ],
    }),
    respond: multiResponder(),
  })
  assert.deepEqual(calls, [], 'only a SOLE open dependency is a safe stack base')
})

check('a rebase returning pending keeps both status and stack marker', async () => {
  const { result } = await run('issue-multi-pr.js', {
    args: multiArgs({
      subPrs: [
        node('a', { status: 'merged', branch: 'fix/FIX-9-a' }),
        node('b', { dependsOn: ['a'], status: 'open', stackedOn: 'fix/FIX-9-a', branch: 'fix/FIX-9-b', pr: 2 }),
      ],
    }),
    respond: multiResponder({ build: { b: { status: 'pending', pr: 2, branch: 'fix/FIX-9-b' } } }),
  })
  const b = result.subPrs.find((n) => n.id === 'b')
  assert.equal(b.status, 'open', 'a rebase must never demote an open sub-PR to pending')
  assert.equal(b.stackedOn, 'fix/FIX-9-a', 'and the marker survives so the rebase retries')
})

check('a dead assembled-goal agent retries instead of filing a phantom gap', async () => {
  const { result, calls, logs } = await run('issue-multi-pr.js', {
    args: multiArgs({ subPrs: [node('a', { status: 'merged' })] }),
    respond: multiResponder({ nulls: ['assembled-goal:'] }),
  })
  assert.deepEqual(calls.map((c) => c.label), ['assembled-goal:FIX-9'], 'no repair dispatched off a dead agent')
  assert.equal(result.incomplete, 'assembled-goal')
  assert.equal(result.assembledGoal.failure, undefined, 'no failure recorded, so the next wake retries the GOAL')
  assert.equal(result.done, false)
  assert.match(logs.join('\n'), /incomplete attempt, retrying next wake. No gap filed/)
})

check('a merged dependency triggers a rebase off the stack and clears the marker', async () => {
  const { result, calls } = await run('issue-multi-pr.js', {
    args: multiArgs({
      subPrs: [
        node('a', { status: 'merged', branch: 'fix/FIX-9-a' }),
        node('b', { dependsOn: ['a'], status: 'open', stackedOn: 'fix/FIX-9-a', branch: 'fix/FIX-9-b', pr: 2 }),
      ],
    }),
    respond: multiResponder({ build: { b: { status: 'open', pr: 2, branch: 'fix/FIX-9-b' } } }),
  })
  assert.deepEqual(calls.map((c) => c.label), ['rebase:b'])
  assert.match(calls[0].prompt, /Rebase it onto fresh origin\/main/)
  assert.match(calls[0].prompt, /Do not merge it/)
  assert.equal(result.subPrs.find((n) => n.id === 'b').stackedOn, null)
})

check('the last merge is not DONE — the assembled goal runs first', async () => {
  const { result, calls, phases } = await run('issue-multi-pr.js', {
    args: multiArgs({ subPrs: [node('a', { status: 'merged' }), node('b', { status: 'merged', dependsOn: ['a'] })] }),
    respond: multiResponder(),
  })
  assert.deepEqual(phases, ['Assemble'])
  assert.deepEqual(calls.map((c) => c.label), ['assembled-goal:FIX-9'])
  assert.match(calls[0].prompt, /REAL path/)
  assert.match(calls[0].prompt, /cost-based skip is not an acceptable outcome/)
  assert.equal(result.done, true)
})

check('a designated integrating sub-PR is confirmed, not re-run', async () => {
  const { calls, logs } = await run('issue-multi-pr.js', {
    args: multiArgs({
      subPrs: [node('a', { status: 'merged' }), node('b', { status: 'merged' })],
      assembledGoal: { ownedBy: 'b' },
    }),
    respond: multiResponder(),
  })
  assert.match(calls[0].prompt, /Confirm its run was recorded and PASSED — read the verdict, do not re-run/)
  assert.match(logs.join('\n'), /owned by sub-PR b/)
})

check('an already-passed assembled goal is not re-run', async () => {
  const { calls } = await run('issue-multi-pr.js', {
    args: multiArgs({
      subPrs: [node('a', { status: 'merged' })],
      assembledGoal: { passed: true, evidence: 'ran earlier' },
    }),
    respond: multiResponder(),
  })
  assert.deepEqual(calls, [], 'a passed goal is terminal — nothing left to dispatch')
})

check('a failed assembled goal walks gap then fix across wakes, never DONE', async () => {
  // One state, one action per wake — so a death mid-repair resumes instead of restarting.
  const first = await run('issue-multi-pr.js', {
    args: multiArgs({ subPrs: [node('a', { status: 'merged' }), node('b', { status: 'merged' })] }),
    respond: multiResponder({ goal: { passed: false, failure: 'stream stalls on resume', owningSubPr: 'b' } }),
  })
  assert.deepEqual(first.calls.map((c) => c.label), ['assembled-goal:FIX-9'], 'the failure is recorded, the repair is next')
  assert.equal(first.result.assembledGoal.failure, 'stream stalls on resume')
  assert.equal(first.result.done, false)
  assert.match(first.logs.join('\n'), /Issue is not DONE/)

  const second = await run('issue-multi-pr.js', {
    args: multiArgs({ subPrs: [node('a', { status: 'merged' })], assembledGoal: first.result.assembledGoal }),
    respond: multiResponder(),
  })
  assert.deepEqual(second.calls.map((c) => c.label), ['assembled-gap:FIX-9'])
  assert.equal(second.calls[0].agentType, 'issue-manager', 'the gap is filed by issue-manager, not imitated by a worker')
  assert.equal(second.result.assembledGoal.fixIssue, 'FIX-99')

  const third = await run('issue-multi-pr.js', {
    args: multiArgs({ subPrs: [node('a', { status: 'merged' })], assembledGoal: second.result.assembledGoal }),
    respond: multiResponder(),
  })
  assert.deepEqual(third.calls.map((c) => c.label), ['assembled-fix:FIX-9'])
  assert.match(third.calls[0].prompt, /do not attempt to reopen them/)
  assert.equal(third.result.assembledGoal.fixPr, 42, 'the fix PR gates the goal rerun')
  assert.equal(third.result.done, false)
})

check('a failed rebase keeps its stack marker so the next wake retries it', async () => {
  const { result } = await run('issue-multi-pr.js', {
    args: multiArgs({
      subPrs: [
        node('a', { status: 'merged', branch: 'fix/FIX-9-a' }),
        node('b', { dependsOn: ['a'], status: 'open', stackedOn: 'fix/FIX-9-a', branch: 'fix/FIX-9-b', pr: 2 }),
      ],
    }),
    respond: multiResponder({ build: { b: { status: 'failed', pr: 2, branch: 'fix/FIX-9-b' } } }),
  })
  const b = result.subPrs.find((n) => n.id === 'b')
  assert.equal(b.status, 'open', 'a failed rebase leaves the node open')
  assert.equal(b.stackedOn, 'fix/FIX-9-a', 'and still stacked, or nothing ever retries the rebase')
})

check('a node declaring an unknown dependency fails closed', async () => {
  // filter(Boolean) would drop the missing id, leaving zero deps — which reads as "all merged"
  // and builds the dependent onto origin/main before its prerequisite exists.
  const { result, calls, logs } = await run('issue-multi-pr.js', {
    args: multiArgs({ subPrs: [node('b', { dependsOn: ['ghost'] })] }),
    respond: multiResponder(),
  })
  assert.deepEqual(calls, [], 'never build a node whose declared dependency is not in the table')
  assert.deepEqual(result.invalid, [{ id: 'b', missing: ['ghost'] }])
  assert.match(logs.join('\n'), /b: declares unknown dependenc\(ies\) ghost — refusing to build it/)
})

check('a repair worker reporting no PR retries the fix stage, not the goal', async () => {
  // FIX_SCHEMA allows pr: null, which must not read as "repair done".
  const { result, logs } = await run('issue-multi-pr.js', {
    args: multiArgs({
      subPrs: [node('a', { status: 'merged' })],
      assembledGoal: { passed: false, failure: 'boom', fixIssue: 'FIX-99' },
    }),
    respond: multiResponder({ fix: { pr: null } }),
  })
  assert.equal(result.incomplete, 'assembled-fix')
  assert.equal(result.assembledGoal.fixPr, undefined, 'no phantom PR handle')
  assert.equal(result.assembledGoal.fixIssue, 'FIX-99', 'the gap stays filed, so the gap stage is not redone')
  assert.match(logs.join('\n'), /worker reported none.*retrying that stage next wake/)
})

check('an unmerged fix PR blocks the goal rerun instead of filing a duplicate', async () => {
  const { result, calls, logs } = await run('issue-multi-pr.js', {
    args: multiArgs({
      subPrs: [node('a', { status: 'merged' }), node('b', { status: 'merged' })],
      assembledGoal: { passed: false, failure: 'boom', fixIssue: 'FIX-99', fixPr: 42, fixMerged: false },
    }),
    respond: multiResponder(),
  })
  assert.deepEqual(calls, [], 'no goal rerun and no second fix PR while the repair is in flight')
  assert.equal(result.awaitingFix, 42)
  assert.equal(result.done, false)
  assert.match(logs.join('\n'), /fix PR #42 has not merged — not re-running the goal, not filing a duplicate/)
})

check('a merged fix PR re-arms the assembled goal', async () => {
  const { result, calls, logs } = await run('issue-multi-pr.js', {
    args: multiArgs({
      subPrs: [node('a', { status: 'merged' })],
      assembledGoal: { passed: false, failure: 'boom', fixIssue: 'FIX-99', fixPr: 42, fixMerged: true },
    }),
    respond: multiResponder(),
  })
  assert.deepEqual(calls.map((c) => c.label), ['assembled-goal:FIX-9'], 'a landed repair still has to be proven')
  assert.equal(result.done, true)
  assert.match(logs.join('\n'), /Repair #42 merged — re-running the assembled goal to prove it/)
})

check('a dead repair worker resumes at the fix stage, not the goal or the gap', async () => {
  const { result } = await run('issue-multi-pr.js', {
    args: multiArgs({
      subPrs: [node('a', { status: 'merged' })],
      assembledGoal: { passed: false, failure: 'boom', fixIssue: 'FIX-99' },
    }),
    respond: multiResponder({ nulls: ['assembled-fix:'] }),
  })
  assert.equal(result.incomplete, 'assembled-fix')

  const next = await run('issue-multi-pr.js', {
    args: multiArgs({ subPrs: [node('a', { status: 'merged' })], assembledGoal: result.assembledGoal }),
    respond: multiResponder(),
  })
  assert.deepEqual(next.calls.map((c) => c.label), ['assembled-fix:FIX-9'], 'the stalling bug: this must dispatch, not return unchanged')
  assert.equal(next.result.assembledGoal.fixPr, 42)
})

check('a dead issue-manager resumes at the gap stage, never the goal', async () => {
  const { result, calls, logs } = await run('issue-multi-pr.js', {
    args: multiArgs({ subPrs: [node('a', { status: 'merged' })], assembledGoal: { passed: false, failure: 'boom' } }),
    respond: multiResponder({ nulls: ['assembled-gap:'] }),
  })
  assert.deepEqual(calls.map((c) => c.label), ['assembled-gap:FIX-9'], 'no fix dispatched without a filed gap')
  assert.equal(result.incomplete, 'assembled-gap')
  assert.equal(result.assembledGoal.failure, 'boom', 'the confirmed failure is still recorded')
  assert.match(logs.join('\n'), /still owed a gap issue; retrying that stage next wake, not the goal/)

  const next = await run('issue-multi-pr.js', {
    args: multiArgs({ subPrs: [node('a', { status: 'merged' })], assembledGoal: result.assembledGoal }),
    respond: multiResponder(),
  })
  assert.deepEqual(next.calls.map((c) => c.label), ['assembled-gap:FIX-9'], 'retries the gap, does not stall')
})

check('an open build with no PR or branch is treated as incomplete', async () => {
  const { result, logs } = await run('issue-multi-pr.js', {
    args: multiArgs({ subPrs: [node('a')] }),
    respond: multiResponder({ build: { a: { status: 'open', pr: null, branch: null } } }),
  })
  const a = result.subPrs[0]
  assert.equal(a.status, 'pending', 'an open sub-PR with no handles cannot be subscribed to or merged')
  assert.equal(a.pr, null)
  assert.match(logs.join('\n'), /reported open but returned no PR number or branch — treating as incomplete/)
})

check('a sub-PR carrying a human blocker is parked, not re-dispatched', async () => {
  const { calls } = await run('issue-multi-pr.js', {
    args: multiArgs({ subPrs: [node('a', { blocker: 'needs a call on the store shape' })] }),
    respond: multiResponder(),
  })
  assert.deepEqual(calls, [], 'the escalated fork is the human’s, so nothing re-dispatches')
})

check('an open build missing EITHER handle is incomplete', async () => {
  for (const [label, build] of [
    ['no pr', { status: 'open', pr: null, branch: 'fix/FIX-9-a' }],
    ['no branch', { status: 'open', pr: 5, branch: null }],
  ]) {
    const { result } = await run('issue-multi-pr.js', {
      args: multiArgs({ subPrs: [node('a')] }),
      respond: multiResponder({ build: { a: build } }),
    })
    assert.equal(result.subPrs[0].status, 'pending', `${label}: an && guard would have accepted this`)
  }
})

check('a failed re-verification clears spent handles and starts a fresh repair cycle', async () => {
  // The stall: keeping the merged PR in fixPr reads as AWAITING_FIX forever.
  const { result } = await run('issue-multi-pr.js', {
    args: multiArgs({
      subPrs: [node('a', { status: 'merged' })],
      assembledGoal: { passed: false, failure: 'old', fixIssue: 'FIX-99', fixPr: 42, fixMerged: true },
    }),
    respond: multiResponder({ goal: { passed: false, failure: 'still broken', owningSubPr: 'a' } }),
  })
  assert.equal(result.assembledGoal.fixPr, null, 'the spent repair PR must not gate the next cycle')
  assert.equal(result.assembledGoal.fixIssue, null)
  assert.equal(result.assembledGoal.fixMerged, false)

  const next = await run('issue-multi-pr.js', {
    args: multiArgs({ subPrs: [node('a', { status: 'merged' })], assembledGoal: result.assembledGoal }),
    respond: multiResponder(),
  })
  assert.deepEqual(next.calls.map((c) => c.label), ['assembled-gap:FIX-9'], 'a fresh repair cycle, not a stall')
})

check('a blocked gap parks the repair instead of starting it', async () => {
  const { result, calls, logs } = await run('issue-multi-pr.js', {
    args: multiArgs({ subPrs: [node('a', { status: 'merged' })], assembledGoal: { passed: false, failure: 'boom' } }),
    respond: multiResponder({ gap: { issueFiled: 'FIX-99', ready: false } }),
  })
  assert.equal(result.assembledGoal.fixReady, false)
  assert.match(logs.join('\n'), /BLOCKED per issue-manager/)

  const next = await run('issue-multi-pr.js', {
    args: multiArgs({ subPrs: [node('a', { status: 'merged' })], assembledGoal: result.assembledGoal }),
    respond: multiResponder(),
  })
  assert.deepEqual(next.calls, [], 'no repair work while issue-manager says the gap is blocked')
  assert.equal(next.result.blockedGap, 'FIX-99')
})

check('the cap bounds parallel sub-PR builds', async () => {
  const { result, calls, logs } = await run('issue-multi-pr.js', {
    args: multiArgs({ cap: 2, subPrs: [node('a'), node('b'), node('c'), node('d')] }),
    respond: multiResponder(),
  })
  assert.deepEqual(calls.map((c) => c.label), ['build:a', 'build:b'])
  assert.deepEqual(result.deferred, ['c', 'd'])
  assert.match(logs.join('\n'), /Cap 2 reached — deferring c, d/)
})

check('a build wake never reports DONE', async () => {
  const { result } = await run('issue-multi-pr.js', {
    args: multiArgs({ subPrs: [node('a')] }),
    respond: multiResponder(),
  })
  assert.equal(result.done, false, 'merges are the human\'s, and the assembled goal comes after them')
})

// ---------------------------------------------------------------------------
// Invariants over the WHOLE input space
//
// Every round of review so far found the same shape of defect: a state combination nobody wrote
// an example for, which either stalls the lifecycle or silently consumes work. These checks
// enumerate the inputs instead of sampling them, so that class fails here rather than in review.
// ---------------------------------------------------------------------------

check('INVARIANT: no assemble state is a dead end', async () => {
  const { assembleState } = loadRules('issue-multi-pr.js', ['allMerged', 'assembleState'])
  const src = readFileSync(join(HERE, 'issue-multi-pr.js'), 'utf8')

  // States that DISPATCH something, and states that WAIT. A waiting state is only legitimate if
  // it waits on a handle a human can actually act on — otherwise it is a stall.
  const dispatching = ['NEEDS_GOAL', 'NEEDS_GAP', 'NEEDS_FIX']
  const waitingOn = { AWAITING_FIX: 'fixPr', GAP_BLOCKED: 'fixIssue' }
  const terminal = ['DONE', null]

  const nodes = [{ id: 'a', dependsOn: [], status: 'merged' }]
  const space = product({
    passed: [true, false, undefined],
    failure: ['boom', undefined],
    fixIssue: ['FIX-99', null, undefined],
    fixReady: [true, false, undefined],
    fixPr: [42, null, undefined],
    fixMerged: [true, false, undefined],
  })

  let stalls = 0
  for (const goal of space) {
    const state = assembleState(nodes, goal)
    const known = dispatching.includes(state) || state in waitingOn || terminal.includes(state)
    assert.ok(known, `unknown state ${state} for ${JSON.stringify(goal)}`)

    // Every dispatching state must have a branch in the script, or nothing acts on it.
    if (dispatching.includes(state)) {
      assert.ok(src.includes(`state === '${state}'`), `${state} is returned but never handled`)
    }
    // A waiting state with nothing to wait on is a stall.
    if (state in waitingOn && !goal[waitingOn[state]]) {
      stalls++
      assert.fail(`${state} with no ${waitingOn[state]} — waits on nothing: ${JSON.stringify(goal)}`)
    }
  }
  assert.equal(stalls, 0)
  assert.ok(space.length >= 200, `expected a real space, enumerated ${space.length}`)
})

check('INVARIANT: a parked row is never dispatched, whatever else is true', async () => {
  const { pendingAction } = loadRules('epic-wake.js', ['atReviewBudget', 'pendingAction'])
  const space = product({
    phase: ['NEEDS_SPEC', 'AWAITING_SPEC_APPROVAL', 'NEEDS_IMPLEMENTATION', 'PR_FEEDBACK', 'DONE'],
    specApproved: [true, false],
    newSpecReviewEvents: [true, false],
    newPrEvents: [true, false],
    ciFailed: [true, false],
    specReviewRounds: [0, 1, 2, 3],
    specLevelFound: [true, false],
    verdicts: [[], [{ claim: 'c', verdict: 'REFUTED' }]],
  })

  for (const base of space) {
    // Parked by an open blocked-by relation, or by an escalated decision. Neither may dispatch,
    // no matter what phase or event the row also carries.
    assert.equal(pendingAction({ ...base, blockedBy: ['FIX-9'] }), null, `blockedBy dispatched: ${JSON.stringify(base)}`)
    assert.equal(pendingAction({ ...base, blocker: 'needs a call' }), null, `blocker dispatched: ${JSON.stringify(base)}`)

    // And an unparked row never invents an action outside the known set.
    const next = pendingAction(base)
    if (next) {
      assert.ok(
        ['spec', 'spec-review', 'implement', 'pr-feedback', 'apply-verdict'].includes(next.action),
        `unknown action ${next.action}`,
      )
      assert.ok(next.why, 'every dispatch must be explainable')
    }
  }
  assert.ok(space.length >= 500, `expected a real space, enumerated ${space.length}`)
})

check('INVARIANT: the activity cursor never advances past unconsumed activity', async () => {
  const { nextRow } = loadRules('epic-wake.js', ['atReviewBudget', 'pendingAction', 'CONSUMES_REVIEW_ACTIVITY', 'nextRow'])
  const actions = [undefined, 'spec', 'spec-review', 'implement', 'pr-feedback', 'apply-verdict']

  for (const action of actions) {
    for (const workerReturned of [true, false]) {
      for (const newSpecReviewEvents of [true, false]) {
        for (const newPrEvents of [true, false]) {
          const row = {
            id: 'FIX-2',
            phase: 'AWAITING_SPEC_APPROVAL',
            newSpecReviewEvents,
            newPrEvents,
            latestActivityAt: 'new',
            headSha: 'newsha',
            lastSeenActivityAt: 'old',
            lastSeenSha: 'oldsha',
          }
          const out = nextRow(row, {
            worker: workerReturned ? { issueId: 'FIX-2', phase: 'AWAITING_SPEC_APPROVAL' } : undefined,
            action,
            landed: [],
            folded: false,
          })
          const advanced = out.lastSeenActivityAt === 'new'
          const hadActivity = newSpecReviewEvents || newPrEvents
          const consumed = workerReturned && (action === 'spec-review' || action === 'pr-feedback')
          // The whole of invariant 2, as one implication over the entire space.
          assert.equal(
            advanced,
            !hadActivity || consumed,
            `cursor advanced=${advanced} for action=${action} worker=${workerReturned} activity=${hadActivity}`,
          )
        }
      }
    }
  }
})

check('INVARIANT: a dead worker never mutates a row beyond its cursor', async () => {
  const { nextRow } = loadRules('epic-wake.js', ['atReviewBudget', 'pendingAction', 'CONSUMES_REVIEW_ACTIVITY', 'nextRow'])
  const row = {
    id: 'FIX-2',
    phase: 'AWAITING_SPEC_APPROVAL',
    specPr: 7,
    implPr: null,
    specReviewRounds: 2,
    specLevelFound: true,
    blocker: null,
    verdicts: [{ claim: 'c', verdict: 'REFUTED' }],
    blockedBy: ['FIX-9'],
  }
  for (const action of ['spec-review', 'apply-verdict', 'implement', 'pr-feedback']) {
    const out = nextRow(row, { worker: undefined, action, landed: [], folded: false })
    for (const key of ['phase', 'specPr', 'implPr', 'specReviewRounds', 'specLevelFound', 'blockedBy']) {
      assert.deepEqual(out[key], row[key], `${key} changed on a dead worker (action=${action})`)
    }
    assert.deepEqual(out.verdicts, row.verdicts, 'a dead worker consumes no verdict')
  }
})

// ---------------------------------------------------------------------------
// meta contract — phases declared must match the phases actually started
// ---------------------------------------------------------------------------

check('every phase() a script can start is declared in meta.phases', async () => {
  for (const name of ['epic-wake.js', 'issue-multi-pr.js']) {
    const src = readFileSync(join(HERE, name), 'utf8')
    const declared = [...src.matchAll(/\{ title: '([^']+)'/g)].map((m) => m[1])
    const started = [...src.matchAll(/^phase\('([^']+)'\)/gm)].map((m) => m[1])
    assert.ok(declared.length > 0, `${name}: meta.phases must not be empty`)
    for (const title of started) {
      assert.ok(declared.includes(title), `${name}: phase('${title}') is started but not declared in meta.phases`)
    }
    // `phase: 'X'` appears in two unrelated roles in these scripts: a workflow progress group on
    // an agent() options object (Capitalized), and an ISSUE LIFECYCLE phase on a row
    // (SCREAMING_SNAKE, e.g. NEEDS_SPEC). Only the former has to match meta.phases.
    const optPhases = [...src.matchAll(/phase: '([^']+)'/g)].map((m) => m[1]).filter((t) => !/^[A-Z][A-Z_]*$/.test(t))
    for (const title of optPhases) {
      assert.ok(declared.includes(title), `${name}: opts.phase '${title}' is not declared in meta.phases`)
    }
  }
})

// ---------------------------------------------------------------------------

let failed = 0
for (const { name, fn } of checks) {
  try {
    await fn()
    console.log(`  ok   ${name}`)
  } catch (err) {
    failed++
    console.log(`  FAIL ${name}`)
    console.log(`       ${err.message.split('\n').slice(0, 6).join('\n       ')}`)
  }
}

console.log(`\n${checks.length - failed}/${checks.length} passed`)
process.exit(failed ? 1 : 0)
