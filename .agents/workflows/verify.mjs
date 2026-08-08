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
 * Enough JSON Schema to hold the stubs honest: required keys, `additionalProperties: false`,
 * declared types, and enums. Returns a list of violations, empty when the value would be
 * accepted. Not a general validator — it only needs to cover what these scripts' schemas use.
 */
function schemaViolations(value, schema, path = '') {
  const out = []
  const types = [].concat(schema.type || [])
  const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  if (types.length && !types.includes(actual)) {
    out.push(`${path || 'root'} is ${actual}, schema allows ${types.join('|')}`)
    return out
  }
  if (schema.enum && !schema.enum.includes(value)) out.push(`${path} "${value}" not in enum`)
  if (actual === 'array' && schema.items) {
    value.forEach((v, i) => out.push(...schemaViolations(v, schema.items, `${path}[${i}]`)))
  }
  if (actual === 'object') {
    for (const key of schema.required || []) {
      if (!(key in value)) out.push(`${path}.${key} is required but missing`)
    }
    if (schema.additionalProperties === false && schema.properties) {
      for (const key of Object.keys(value)) {
        if (!(key in schema.properties)) out.push(`${path}.${key} is not declared (additionalProperties:false)`)
      }
    }
    for (const [key, sub] of Object.entries(schema.properties || {})) {
      if (key in value) out.push(...schemaViolations(value[key], sub, `${path}.${key}`))
    }
  }
  return out
}

/**
 * Run a workflow script the way the harness does: `export const meta` becomes a local, and
 * the body runs inside an async function so its top-level `return` is the script's result.
 *
 * @param {string} name script filename under this directory
 * @param {object} opts `args` for the script, `respond(prompt, opts)` for each agent() call, and
 *   `argsShape` — `'string'` (default, the shape the Workflow tool actually delivers) or
 *   `'object'` to exercise the normalizer's other branch.
 * @returns {Promise<{result: unknown, calls: object[], logs: string[], phases: string[], meta: object}>}
 */
async function run(name, { args, respond, argsShape = 'string' }) {
  // Hoist `meta` out the way the harness does, and capture it as the declaration executes —
  // no second parse of the source, so reformatting the object literal can't break this.
  const capture = {}
  const src = readFileSync(join(HERE, name), 'utf8').replace(/^export const meta\s*=/m, 'const meta = capture.meta =')

  const calls = []
  const logs = []
  const phases = []
  const invalid = []

  const agent = async (prompt, opts = {}) => {
    calls.push({ prompt, ...opts })
    const result = respond(prompt, opts)
    // The real hook returns ONLY schema-validated objects — an agent that can't satisfy the schema
    // yields null. A mirror that skips validation lets fixtures exercise responses the harness
    // would reject, so a passing test can describe a branch that never runs. Collected rather than
    // thrown: `parallel`/`pipeline` swallow throws into null, which would hide the real cause.
    if (opts.schema && result !== null && result !== undefined) {
      const bad = schemaViolations(result, opts.schema)
      if (bad.length) invalid.push(`"${opts.label}": ${bad.join('; ')}`)
    }
    return result
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

  // Inject `args` the way the Workflow tool actually delivers it — as a JSON string — by default.
  // Fixtures stay readable plain objects and only this boundary changes, so the whole suite
  // exercises the same parse the runtime does. Injecting the object directly is what let a
  // production-fatal bug pass 266 tests: the scripts read `args.epic` off a string, got `undefined`
  // for every field, and died before spawning an agent. A harness on a different shape than
  // production tests nothing about production.
  //
  // `argsShape: 'object'` keeps the normalizer's other branch covered — ad-hoc harness runs and
  // any future object delivery take it, so it should not rot untested either.
  const injectedArgs = argsShape === 'object' ? args : JSON.stringify(args)
  const result = await body(agent, parallel, pipeline, log, phase, injectedArgs, budget, workflow, capture)

  // A fixture the real harness would reject makes whatever this test asserts meaningless.
  assert.equal(
    invalid.length,
    0,
    `${name}: stub response(s) violate the agent schema, so the real harness would return null instead — this test would be exercising a branch that cannot happen:\n  ${invalid.join('\n  ')}`,
  )

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
/**
 * The full `{ ... }` declaration starting at `from`, by brace matching.
 *
 * Schema checks used a fixed byte window, which quietly truncates as schemas grow — the failure
 * mode is a check that reports a defect in the part it can see rather than the part it can't.
 */
function balancedFrom(src, from) {
  return balancedDelimited(src, from, '{', '}')
}

/**
 * The declaration starting at `from`, matched to its closing delimiter.
 *
 * Brace-only matching swallowed a whole following declaration when the value was an ARRAY: with no `{`
 * of its own, `const LIFECYCLE_PHASES = [...]` ran on to the next schema's braces, so evaluating the
 * collected declarations hit the same name twice. Pick the delimiter the value actually opens with.
 */
function balancedDelimited(src, from, o, c) {
  const open = src.indexOf(o, from)
  if (open < 0) return src.slice(from)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === o) depth++
    else if (src[i] === c && --depth === 0) return src.slice(from, i + 1)
  }
  return src.slice(from)
}

/**
 * The declaration at `from`, bounded correctly whatever shape its value is.
 *
 * A scalar (`const REVIEW_BUDGET = 2`) opens no delimiter at all, so searching forward for the next
 * `{`/`[` ran past the statement and swallowed the following declaration whole — which then declared
 * that name twice when the collected text was evaluated. So: look at what the value actually starts
 * with, and fall back to the end of the line.
 */
function balancedDecl(src, from) {
  const eq = src.indexOf('=', from)
  if (eq < 0) return src.slice(from)
  let i = eq + 1
  while (i < src.length && (src[i] === ' ' || src[i] === '\t')) i++
  if (src[i] === '{') return balancedDelimited(src, from, '{', '}')
  if (src[i] === '[') return balancedDelimited(src, from, '[', ']')
  const nl = src.indexOf('\n', i)
  return nl < 0 ? src.slice(from) : src.slice(from, nl)
}

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
function epicResponder({ approved = true, approvedByLabel = false, gateHeadSha = 'abc', epicReviewEvents = false, fresh = {}, worker = {}, poc = {}, fold = {}, linear = {}, nulls = [] } = {}) {
  return (prompt, opts) => {
    const label = opts.label || ''
    // `nulls` names labels whose agent "died" — the harness returns null for those.
    if (nulls.includes(label)) return null
    if (label === 'gate:epic') {
      return { approved, approvedByLabel, approver: approved ? 'jake' : null, headSha: gateHeadSha, newReviewEvents: epicReviewEvents, latestActivityAt: '2026-07-05T00:00:00Z' }
    }
    if (label === 'fold:epic') return { roundsSpent: 1, aboveBar: false, folded: 'tightened the objective', fanOut: [], ...fold }
    if (label === 'route:epic-notes') return { notes: [] }
    // `linear` overrides a child's Linear state, as a bare state string or `{ state, blockedBy }`. Both
    // are only ever OBSERVED here — the refresh scout's schema has neither field — so a fixture that sets
    // them on the row instead describes a response the real harness would reject.
    if (label === 'linear:epic-children') {
      return {
        issues: Object.keys(fresh).map((id) => {
          const li = typeof linear[id] === 'string' ? { state: linear[id] } : linear[id] || {}
          // `category` is what ROUTES the issue ("Bug" → the direct route, no spec). Defaulted to null
          // rather than omitted so the common fixture exercises the observed-but-unreadable case, which
          // must fall back to the spec route — the safe direction.
          return { id, state: li.state || 'In Spec Review', blockedBy: li.blockedBy || [], category: li.category ?? null }
        }),
      }
    }
    if (label.startsWith('refresh:')) {
      const id = label.slice('refresh:'.length)
      // Via `freshRow`, not a second copy of the same defaults. Keeping two lists is what let them
      // drift: a newly required field was added to one and the other kept producing responses the real
      // harness would reject, which the fixture validator then reported against every check at once.
      return { issueId: id, ...freshRow(fresh[id] || {}) }
    }
    if (label.startsWith('poc:')) return { claim: 'c', verdict: 'CONFIRMED', evidence: 'ran it', ...poc }
    const id = label.split(':')[1]
    return { issueId: id, phase: 'AWAITING_SPEC_APPROVAL', readyToMerge: false, multiPrPending: false, ...(worker[id] || {}) }
  }
}

const row = (id, over = {}) => ({ id, phase: 'NEEDS_SPEC', specReviewRounds: 0, specLevelFound: false, ...over })

/**
 * Schema-complete fixtures. Every REQUIRED field has a default, so an inline responder can never
 * describe a response the real harness would reject — the failure mode Codex found in 11 tests.
 */
const freshRow = (over = {}) => ({
  phase: 'NEEDS_SPEC',
  specApproved: false,
  specApprovedByLabel: false,
  newSpecReviewEvents: false,
  newPrEvents: false,
  readyToMerge: false,
  merged: false,
  ciFailed: false,
  // A scan that reports activity reports WHEN it happened — without it the cursor cannot advance and
  // the wake deliberately withholds the work. Defaulting it here keeps that pathological combination
  // something a check has to ask for (`latestActivityAt: null`) rather than get by omission.
  latestActivityAt: 'new',
  // Same reasoning for the head: a scan-derived approval is only an approval OF a head, so the default
  // supplies one and a check that wants the pathological case has to ask for `headSha: null`.
  headSha: 'abc',
  ...over,
})
const workerRes = (over = {}) => ({ phase: 'AWAITING_SPEC_APPROVAL', readyToMerge: false, multiPrPending: false, ...over })

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

check('the `epic approved` label signs the objective off, and only its removal revokes that', async () => {
  // The owner marks the objective approved with the LABEL as well as by comment. Reading only
  // comments held a fully-approved epic's entire set indefinitely while the label sat on the PR —
  // and the coordinator cannot assert the gate from `args`, because a live scan overrides the
  // carried value by design. So the label has to reach the gate, or that epic never starts.
  const byLabel = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'NEEDS_SPEC' })] }),
    respond: epicResponder({ approved: false, approvedByLabel: true, fresh: { 'FIX-2': { phase: 'NEEDS_SPEC' } } }),
  })
  assert.equal(byLabel.result.epicApproved, true, 'the label alone signs the objective off')
  assert.deepEqual(byLabel.result.held, [], 'and releases the set')
  assert.ok(workerLabels(byLabel.calls).length > 0, 'so work is actually dispatched')

  // The label does NOT expire on a push. An epic-spec PR takes commits for the whole life of the
  // epic — every fold is one — so a staleness rule would revoke the objective on the next edit and
  // re-hold the set, which is the stall this exists to remove. Removing the label is the revocation,
  // so absence, and only absence, holds the gate.
  const noLabel = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'NEEDS_SPEC' })] }),
    respond: epicResponder({ approved: false, approvedByLabel: false, fresh: { 'FIX-2': { phase: 'NEEDS_SPEC' } } }),
  })
  assert.equal(noLabel.result.epicApproved, false, 'no label and no approving comment holds the gate')
  assert.deepEqual(noLabel.result.held, ['FIX-2'], 'and the set stays held')
  assert.deepEqual(noLabel.result.gates, [{ kind: 'epic-objective', pr: 100 }], 'with the gate surfaced')

  // Fold activity must not disturb it: the label still approves on a wake that is folding new
  // epic-PR feedback, which is exactly the wake a commit-based staleness rule would have broken.
  const whileFolding = await run('epic-wake.js', {
    args: epicArgs({ epic: { issueId: 'FIX-1', branch: 'epic/t', prNumber: 100, reviewRounds: 0 }, issues: [row('FIX-2', { phase: 'NEEDS_SPEC' })] }),
    respond: epicResponder({
      approved: false,
      approvedByLabel: true,
      epicReviewEvents: true,
      fresh: { 'FIX-2': { phase: 'NEEDS_SPEC' } },
    }),
  })
  assert.equal(whileFolding.result.epicApproved, true, 'a labelled epic stays approved while its spec is being folded')
})

check('the `spec approved` label passes an issue spec gate too', async () => {
  // The contract advertises the label as an approval channel for BOTH gates. Wiring only the epic
  // one left every per-issue spec able to stall the identical way — labelled approved, read as
  // unapproved, parked in AWAITING_SPEC_APPROVAL forever.
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 })] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8, specApproved: false, specApprovedByLabel: true, headSha: 'abc' } },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 11 } },
    }),
  })
  // A satisfied gate is a release, not a stop: the approved spec chains straight into implementation
  // rather than being offered back to the human as a second "ok to implement?".
  assert.deepEqual(workerLabels(calls), ['implement:FIX-2'], 'a label-approved spec goes straight to implementation')
  assert.ok(
    !(result.gates || []).some((g) => g.kind === 'spec-approval'),
    'and is not re-offered for an approval it already has',
  )
})

check('a finished prerequisite stops blocking; a cancelled one does not', async () => {
  // A scout that keeps reporting a prerequisite after it merged blocks the dependent PERMANENTLY:
  // `pendingAction` refuses any row with a `blockedBy`, and the refresh overwrites the carried
  // value, so the coordinator cannot correct it from args either. Observed live — an issue came
  // back blocked by three already-Done prerequisites.
  const done = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'NEEDS_SPEC' }), row('FIX-3', { phase: 'NEEDS_SPEC' })] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'NEEDS_SPEC' }, 'FIX-3': { phase: 'NEEDS_SPEC' } },
      linear: { 'FIX-2': 'Done', 'FIX-3': { state: 'Backlog', blockedBy: ['FIX-2'] } },
    }),
  })
  assert.deepEqual(done.result.blocked, [], 'a prerequisite that landed must stop blocking its dependents')
  assert.ok(
    workerLabels(done.calls).some((l) => l.endsWith('FIX-3')),
    'the dependent must actually be dispatched once its blocker is done',
  )

  // The opposite error, and the worse one: cancelled/duplicate/dropped work never landed, so
  // clearing it would admit a dependent whose prerequisite does not exist. It keeps blocking and
  // is said out loud, since nothing in the loop can ever clear it on its own.
  // FIX-2 must be a KNOWN child here, not merely referenced: an unknown blocker is kept by the
  // unresolvable-blocker branch, which would make this pass for the wrong reason and prove nothing
  // about cancellation.
  const cancelled = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'NEEDS_SPEC' }), row('FIX-3', { phase: 'NEEDS_SPEC' })] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'NEEDS_SPEC' }, 'FIX-3': { phase: 'NEEDS_SPEC' } },
      linear: { 'FIX-2': 'Canceled', 'FIX-3': { state: 'Backlog', blockedBy: ['FIX-2'] } },
    }),
  })
  assert.deepEqual(
    cancelled.result.blocked.map((b) => b.issueId),
    ['FIX-3'],
    'a cancelled prerequisite never landed, so its dependent stays blocked',
  )
  assert.match(cancelled.logs.join('\n'), /cancelled, not completed/, 'and the dead-end is logged rather than silent')
})

check('args are read identically whether delivered as a JSON string or an object', async () => {
  // The Workflow tool delivers `args` as a JSON string; ad-hoc harness runs pass an object. The
  // scripts normalize both, and BOTH branches need coverage: the suite runs on the string shape,
  // so without this the object branch would rot untested, and a normalizer that dropped it would
  // still be green. Same fixture, same responder, both shapes, identical decisions.
  const fixture = () => ({
    args: epicArgs({ issues: [row('FIX-2'), row('FIX-3')] }),
    respond: epicResponder({ approved: false, fresh: { 'FIX-2': { phase: 'NEEDS_SPEC' }, 'FIX-3': { phase: 'NEEDS_SPEC' } } }),
  })
  const asString = await run('epic-wake.js', { ...fixture(), argsShape: 'string' })
  const asObject = await run('epic-wake.js', { ...fixture(), argsShape: 'object' })

  assert.deepEqual(asObject.result.held, asString.result.held, 'object-delivered args must hold the same issues')
  assert.deepEqual(asObject.result.gates, asString.result.gates, 'object-delivered args must surface the same gates')
  assert.equal(asObject.result.epicApproved, asString.result.epicApproved)
  // The failure this guards against is silent: reading `args.epic` off a string yields `undefined`
  // for every field, so the wake looks like it ran against an empty table rather than crashing.
  assert.ok(asString.result.held.length > 0, 'the string shape must actually reach the rows, not read an empty table')
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
      if (label === 'gate:epic') return { approved: true, approvedByLabel: false, headSha: 'abc', newReviewEvents: false, latestActivityAt: null }
      if (label === 'linear:epic-children') {
        return {
          issues: [
            { id: 'FIX-2', state: 'Todo', blockedBy: ['FIX-9'] },
            { id: 'FIX-3', state: 'Todo', blockedBy: [] },
          ],
        }
      }
      if (label.startsWith('refresh:')) return { issueId: label.slice(8), ...freshRow() }
      return { issueId: label.split(':')[1], ...workerRes() }
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
      if (label === 'gate:epic') return { approved: true, approvedByLabel: false, headSha: 'abc', newReviewEvents: false, latestActivityAt: null }
      if (label === 'linear:epic-children') return { issues: [{ id: 'FIX-2', state: 'x', blockedBy: [] }] }
      if (label.startsWith('refresh:')) return { issueId: 'FIX-2', ...freshRow({ phase: 'PR_FEEDBACK' }) }
      if (label === 'poc:claim one') return { claim: 'claim one', verdict: 'CONFIRMED', evidence: 'a' }
      if (label === 'poc:claim two') return { claim: 'claim two', verdict: 'REFUTED', evidence: 'b' }
      return { issueId: 'FIX-2', ...workerRes({ phase: 'PR_FEEDBACK' }) }
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
      if (label === 'gate:epic') return { approved: true, approvedByLabel: false, headSha: 'abc', newReviewEvents: false, latestActivityAt: null }
      // A present row is authoritative and CLEARS a resolved relation — but it has to SAY it has no
      // blockers. This fixture used to omit the field and assert the omission meant "none", which is
      // precisely the reading that admitted a still-blocked issue alongside its prerequisite.
      if (label === 'linear:epic-children') return { issues: [{ id: 'FIX-2', state: 'Todo', blockedBy: [] }] }
      if (label.startsWith('refresh:')) return { issueId: 'FIX-2', ...freshRow() }
      return { issueId: 'FIX-2', ...workerRes() }
    },
  })
  assert.deepEqual(result.blocked, [], 'a merged blocker must actually un-block the issue')
  assert.deepEqual(workerLabels(calls), ['spec:FIX-2'])
})

check("the issue scout is told a human's CHANGES_REQUESTED beats another's approval", async () => {
  // The epic gate prompt has carried this rule from the start; the issue scout asked only for a current-head
  // approved review, so a spec could read approved while a human's latest state was CHANGES_REQUESTED — or
  // while the SAME human had approved and then requested changes.
  const { calls } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 })] }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 } } }),
  })
  const scout = calls.find((c) => c.label === 'refresh:FIX-2')
  assert.ok(scout)
  assert.match(scout.prompt, /Collapse each human's reviews to their latest state first/)
  assert.match(scout.prompt, /ANY human's latest state is CHANGES_REQUESTED the spec is NOT approved/)
  assert.match(scout.prompt, /even when the same person approved earlier/)
})

check('GATE: implementation waits for the cross-spec coherence pass', async () => {
  // An epic's specs are authored in isolation, so each can be locally excellent while the SET claims the
  // same surface twice. `epic-lifecycle` runs one coherence pass before any of it is built — and moving the
  // advance decision into this script left that gate behind entirely, so every spec chained from approval
  // straight into implementation and conflicts surfaced only after the code existed.
  const twoApproved = {
    'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8, specApproved: true, headSha: 'abc' },
    'FIX-3': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 9, specApproved: true, headSha: 'abc' },
  }
  const held = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 }), row('FIX-3', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 9 })],
    }),
    respond: epicResponder({ fresh: twoApproved }),
  })
  assert.deepEqual(workerLabels(held.calls), [], 'nothing is built before the set has been checked')
  assert.ok(held.result.crossSpecGate, 'and the pass is surfaced as a gate, since the user must approve running it')
  assert.deepEqual(held.result.crossSpecGate.issueIds, ['FIX-2', 'FIX-3'])

  // CLEARED: the same two rows implement.
  const cleared = await run('epic-wake.js', {
    args: epicArgs({
      crossSpecCleared: true,
      issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 }), row('FIX-3', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 9 })],
    }),
    respond: epicResponder({ fresh: twoApproved, worker: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 11 }, 'FIX-3': { phase: 'PR_FEEDBACK', implPr: 12 } } }),
  })
  assert.deepEqual(workerLabels(cleared.calls).sort(), ['implement:FIX-2', 'implement:FIX-3'])
  assert.equal(cleared.result.crossSpecGate, undefined)

  // A row already at NEEDS_IMPLEMENTATION is held by the same gate: it reaches implementation by a different
  // branch, and guarding only the approval-chain path left that one open.
  const notStarted = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'NEEDS_IMPLEMENTATION', specPr: 8 }), row('FIX-3', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 9 })],
    }),
    respond: epicResponder({
      fresh: {
        'FIX-2': { phase: 'NEEDS_IMPLEMENTATION', specPr: 8, specApproved: true, headSha: 'abc' },
        'FIX-3': twoApproved['FIX-3'],
      },
    }),
  })
  assert.deepEqual(workerLabels(notStarted.calls), [], 'neither branch to implementation is open while the set is unchecked')

  // A SINGLE-issue epic has no set to check, so it is never held — the gate is about the set.
  const lone = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 })] }),
    respond: epicResponder({
      fresh: { 'FIX-2': twoApproved['FIX-2'] },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 11 } },
    }),
  })
  assert.deepEqual(workerLabels(lone.calls), ['implement:FIX-2'])

  // An epic whose specs are not ALL approved yet still holds the one that is. This sub-case formerly
  // asserted the opposite — that the first approved spec implements while a sibling is still being written
  // — which is the defect the gate exists to prevent: by the time the set could be checked, the first spec
  // had been built for wakes. The pass is not ASKABLE yet (aligning to an unvalidated spec spreads the
  // flaw), and "not askable" is not "go ahead".
  const partial = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 }), row('FIX-3', { phase: 'NEEDS_SPEC' })],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': twoApproved['FIX-2'], 'FIX-3': { phase: 'NEEDS_SPEC' } },
      worker: { 'FIX-3': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 9 } },
    }),
  })
  assert.equal(partial.result.crossSpecGate, undefined, 'the set is not ready to be checked yet')
  assert.ok(!workerLabels(partial.calls).includes('implement:FIX-2'), 'and the approved spec waits with it')
  assert.ok(workerLabels(partial.calls).includes('spec:FIX-3'), 'while the unwritten spec keeps moving')

  // The set the gate ASKS about and the set it HANDS OVER have to be the same set. A sibling already
  // implementing or done has no observable spec approval — its spec PR is closed — so filtering the
  // surfaced list on `specApproved` alone handed a re-run (a newly discovered child invalidates the
  // clearance) only the newcomer, and reported coherence against a spec it never read.
  const rejoined = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 11 }), row('FIX-3', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 9 })],
    }),
    respond: epicResponder({
      fresh: {
        'FIX-2': { phase: 'PR_FEEDBACK', implPr: 11, headSha: 'abc' },
        'FIX-3': twoApproved['FIX-3'],
      },
    }),
  })
  assert.ok(rejoined.result.crossSpecGate, 'the set is checkable: one spec approved, one already past its gate')
  assert.deepEqual(
    rejoined.result.crossSpecGate.issueIds,
    ['FIX-2', 'FIX-3'],
    'the implemented sibling is part of the set being checked, approval observable or not',
  )

  // ...but not a CANCELLED one, which `linearTerminal` would otherwise sweep in. Its spec is dead, and
  // putting it in front of the reviewer manufactures conflicts with work nobody is doing — the
  // over-correction of "when askable, every row qualifies".
  const withCancelled = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 }),
        row('FIX-3', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 9 }),
        row('FIX-4', { phase: 'NEEDS_SPEC' }),
      ],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': twoApproved['FIX-2'], 'FIX-3': twoApproved['FIX-3'], 'FIX-4': { phase: 'NEEDS_SPEC' } },
      linear: { 'FIX-4': 'Canceled' },
    }),
  })
  assert.ok(withCancelled.result.crossSpecGate, 'a cancelled row does not block the ask either')
  assert.deepEqual(withCancelled.result.crossSpecGate.issueIds, ['FIX-2', 'FIX-3'])
})

check('a blocked sibling does not deadlock the cross-spec hold', async () => {
  // B blocked by A is admitted to nothing — `allocate` refuses to author its spec while the relation is
  // open — so a hold that waits for B's spec to be approved waits on an event that cannot happen, while A,
  // the thing that would unblock B, is the row being held. A closed loop, and every wake re-derived it.
  const approved = { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8, specApproved: true, headSha: 'abc' }
  const pair = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 }), row('FIX-3', { phase: 'NEEDS_SPEC' })],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': approved, 'FIX-3': { phase: 'NEEDS_SPEC' } },
      linear: { 'FIX-3': { state: 'Backlog', blockedBy: ['FIX-2'] } },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 11 } },
    }),
  })
  assert.deepEqual(workerLabels(pair.calls), ['implement:FIX-2'], 'the only spec that exists is not a set, so nothing is held for a pass')
  assert.equal(pair.result.crossSpecGate, undefined, 'and no pass is asked for over one spec')

  // Three rows: the blocked one is ignored by the hold, the unwritten one is not.
  const withComing = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 }),
        row('FIX-3', { phase: 'NEEDS_SPEC' }),
        row('FIX-4', { phase: 'NEEDS_SPEC' }),
      ],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': approved, 'FIX-3': { phase: 'NEEDS_SPEC' }, 'FIX-4': { phase: 'NEEDS_SPEC' } },
      linear: { 'FIX-3': { state: 'Backlog', blockedBy: ['FIX-2'] } },
      worker: { 'FIX-4': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 9 } },
    }),
  })
  assert.ok(!workerLabels(withComing.calls).includes('implement:FIX-2'), 'a spec still being written is a set, so the hold engages')
  assert.equal(withComing.result.crossSpecGate, undefined, 'not askable while it is unwritten')

  // ...and once it is approved, the pass covers the two specs that exist — not the blocked row, which has none.
  const ready = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 }),
        row('FIX-3', { phase: 'NEEDS_SPEC' }),
        row('FIX-4', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 9 }),
      ],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': approved, 'FIX-3': { phase: 'NEEDS_SPEC' }, 'FIX-4': { ...approved, specPr: 9 } },
      linear: { 'FIX-3': { state: 'Backlog', blockedBy: ['FIX-2'] } },
    }),
  })
  assert.deepEqual(ready.result.crossSpecGate.issueIds, ['FIX-2', 'FIX-4'])

  // OVER-CORRECTION: blocked is not invisible. A row blocked at IMPLEMENTATION already has an approved
  // spec, and that spec is part of the set — dropping every blocked row would review the set without it and
  // release the others against a conflict it holds.
  const blockedButSpecced = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 }), row('FIX-3', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 9 })],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': approved, 'FIX-3': { ...approved, specPr: 9 } },
      linear: { 'FIX-3': { state: 'Backlog', blockedBy: ['FIX-2'] } },
    }),
  })
  assert.deepEqual(blockedButSpecced.result.crossSpecGate.issueIds, ['FIX-2', 'FIX-3'])
  assert.deepEqual(workerLabels(blockedButSpecced.calls), [], 'and both are held until the pass clears')
})

check('the cross-spec hold clears on a LANDED alignment, not a routed one', async () => {
  // Nothing in the script can see this, which is why it is pinned as a documented rule: a PR comment
  // asking for an alignment leaves the target spec's approval exactly as it was, so `specApproved` still
  // reads true and the next wake starts implementation on the unaligned spec. `crossSpecCleared` is the
  // coordinator's field and the only thing standing between "conflict found" and "conflict built".
  const flat = readFileSync(join(HERE, '..', 'skills', 'epic-lifecycle', 'SKILL.md'), 'utf8').replace(/\s+/g, ' ')
  assert.match(flat, /alignment edit has \*\*landed in its spec\*\* and every spec it changed has \*\*cleared approval again\*\*/)
  assert.match(flat, /Not when the edits are \*routed\*/)
  // And the walkthrough step it defers to still says both things, or the condition above points at nothing.
  assert.match(flat, /\*\*Re-review the aligned specs\*\* and keep the \*\*stop-before-implement\*\* gate/)
})

check('a failed build goes behind its siblings, not in front of them', async () => {
  // Restoring the prior status was right — it still needs building — but left it first in a stable order, so
  // under a cap smaller than the ready set the same failing node was picked every wake and independent
  // slices never got a turn.
  const { calls } = await run('issue-multi-pr.js', {
    args: multiArgs({
      cap: 1,
      subPrs: [
        { id: 'a', status: 'pending', dependsOn: [], buildFailed: true },
        { id: 'b', status: 'pending', dependsOn: [] },
      ],
    }),
    respond: multiResponder(),
  })
  assert.deepEqual(
    calls.filter((c) => /^build:/.test(c.label || '')).map((c) => c.label),
    ['build:b'],
    'the slice that has not failed yet gets the slot',
  )

  // And the failure mark is cleared by a success, so it is a rotation and not a demotion.
  const { result } = await run('issue-multi-pr.js', {
    args: multiArgs({ subPrs: [{ id: 'a', status: 'pending', dependsOn: [], buildFailed: true }] }),
    respond: multiResponder(),
  })
  assert.equal(result.subPrs[0].buildFailed, undefined)
  assert.equal(result.subPrs[0].status, 'open')
})

check('a dead gate scout holds child work, and keeps the approval for persistence', async () => {
  // This check formerly asserted the OPPOSITE — that a durable approval releases work through a dead scan,
  // so infrastructure failure could not re-lock an epic. That was sound while the epic approval was a
  // one-time objective sign-off. Once a push could invalidate it, the fallback stopped being sound and
  // nobody revisited it: H1 approved, a push creates H2, the scout dies, `headUnconfirmed` is still false
  // because no live scan has seen H2 — and the carried `true` released every child against an objective
  // nobody approved. The cost of the reversal is one wake of held work per flaky scan; the next usable scan
  // releases it. The cost of the old rule was children authoring against an objective that had moved.
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({
      epic: { issueId: 'FIX-1', branch: 'epic/t', prNumber: 100, approved: true },
      issues: [row('FIX-2')],
    }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'NEEDS_SPEC' } }, nulls: ['gate:epic'] }),
  })
  assert.equal(result.epicApproved, false, 'an unconfirmable approval does not release work')
  assert.deepEqual(workerLabels(calls), [], 'so no child is dispatched this wake')
  assert.equal(result.epic.approved, true, 'but the approval itself is NOT discarded — the human gave it once')

  // The next wake with a usable scan releases immediately: the hold is per-wake, not a re-lock.
  const recovered = await run('epic-wake.js', {
    args: epicArgs({ epic: { issueId: 'FIX-1', branch: 'epic/t', prNumber: 100, approved: true }, issues: [row('FIX-2')] }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'NEEDS_SPEC' } } }),
  })
  assert.equal(recovered.result.epicApproved, true)
  assert.deepEqual(workerLabels(recovered.calls), ['spec:FIX-2'])
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
      if (label === 'gate:epic') return { approved: true, approvedByLabel: false, headSha: 'abc', newReviewEvents: true, latestActivityAt: 'new' }
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

check('GATE: a stale specApproved can never survive a live refresh', async () => {
  // The worst class in this design — implementing on a head the human never approved. The row
  // carries specApproved:true from an earlier head; the live scan reports the new head and does
  // NOT report approval. Spreading `fresh` over the row would leave the stale `true` in place.
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7, specApproved: true })] }),
    respond: (prompt, opts) => {
      const label = opts.label || ''
      if (label === 'gate:epic') return { approved: true, approvedByLabel: false, headSha: 'abc', newReviewEvents: false, latestActivityAt: null }
      if (label === 'linear:epic-children') return { issues: [{ id: 'FIX-2', state: 'x', blockedBy: [] }] }
      // Schema-valid, reports the pushed head, omits nothing required — but says NOT approved.
      if (label.startsWith('refresh:')) {
        return { issueId: 'FIX-2', ...freshRow({ phase: 'AWAITING_SPEC_APPROVAL', specPr: 7, headSha: 'pushed' }) }
      }
      return { issueId: 'FIX-2', ...workerRes() }
    },
  })
  assert.equal(result.issues[0].specApproved, false, 'a push re-opens the gate')
  assert.deepEqual(workerLabels(calls), [], 'and nothing implements against it')
  assert.ok(
    result.gates.some((g) => g.kind === 'spec-approval' && g.issueId === 'FIX-2'),
    'the gate is surfaced again instead',
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
      if (label === 'gate:epic') return { approved: true, approvedByLabel: false, headSha: 'abc', newReviewEvents: false, latestActivityAt: null }
      // issue-manager parented FIX-7 under the epic mid-run; the Linear scan is where it appears.
      if (label === 'linear:epic-children') {
        return {
          issues: [
            { id: 'FIX-2', state: 'Todo', blockedBy: [] },
            { id: 'FIX-7', state: 'Todo', blockedBy: [] },
          ],
        }
      }
      if (label.startsWith('refresh:')) return { issueId: label.slice(8), ...freshRow() }
      return { issueId: label.split(':')[1], ...workerRes() }
    },
  })
  assert.ok(
    result.issues.some((r) => r.id === 'FIX-7' && r.discovered),
    'a table built only from carried rows would make discovered work invisible',
  )
  assert.deepEqual(workerLabels(calls).sort(), ['spec:FIX-2', 'spec:FIX-7'])
  assert.match(logs.join('\n'), /Discovered 1 new sub-issue\(s\) under the epic: FIX-7/)
})

// ---------------------------------------------------------------------------
// The two routes → orchestration.md § "Which issues get a spec"
// ---------------------------------------------------------------------------

check('ROUTE: a bug goes straight to implementation with no spec', async () => {
  // The whole direct route in one check: the Linear category decides it, the phase is corrected
  // away from NEEDS_SPEC, `issue-spec` is never dispatched, and no spec-approval gate is offered
  // for a spec that will never exist.
  const { result, calls, logs } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2')] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'NEEDS_SPEC' } },
      linear: { 'FIX-2': { state: 'Todo', category: 'Bug' } },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 40 } },
    }),
  })
  assert.deepEqual(workerLabels(calls), ['implement:FIX-2'], 'a bug must not be dispatched to issue-spec')
  assert.equal(result.issues[0].route, 'direct')
  assert.deepEqual(
    result.gates.filter((g) => g.kind === 'spec-approval'),
    [],
    'a spec-approval gate for an issue with no spec parks the row on an answer nobody can give',
  )
  assert.match(logs.join('\n'), /FIX-2: bug — direct route, implementing with no spec/)

  // And the dispatch has to SAY so: a fresh sub-agent that cannot read the coordinator's table
  // would otherwise look for a spec, fail to find one, and report the absence as a blocker.
  const dispatch = calls.find((c) => c.label === 'implement:FIX-2')
  assert.match(dispatch.prompt, /ROUTE: direct \(this is a BUG\)/)
  // ...and it is told to run the one lookup that keeps a discovered-but-already-specced bug gated.
  // A row discovered this wake was never in the PR-state scout batch, so the script's `specPr` is
  // unknown rather than known-absent; the worker is the only thing that writes code, so the check
  // lands there.
  assert.match(dispatch.prompt, /confirm no spec PR exists/)
  assert.match(dispatch.prompt, /Do not implement past an open spec gate/)
  // ...and it must NOT ask the worker to report anything the schema can't carry. `WORKER_SCHEMA`
  // is additionalProperties:false with no `route`, so a worker obeying such an instruction fails
  // validation AFTER implementing — losing the impl PR handle for work that really happened.
  assert.ok(!/[Rr]eturn route:/.test(dispatch.prompt), 'the prompt must not request a field the schema rejects')
})

check('ROUTE: an unreadable category keeps the issue on the spec route', async () => {
  // Fails CLOSED. An unread label costs one unnecessary document; guessing `direct` ships a feature
  // through the one route with no gate in front of it.
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2')] }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'NEEDS_SPEC' } } }), // category defaults to null
  })
  assert.equal(result.issues[0].route, 'spec')
  assert.deepEqual(workerLabels(calls), ['spec:FIX-2'])
})

check('ROUTE: a bug that already has a spec PR keeps its spec gate', async () => {
  // Someone specced it deliberately — honour that rather than stranding a reviewed document and
  // implementing past its open approval gate.
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 })] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 } },
      linear: { 'FIX-2': { state: 'In Spec Review', category: 'Bug' } },
    }),
  })
  assert.equal(result.issues[0].route, 'spec', 'an existing spec PR outranks the Bug label')
  assert.deepEqual(workerLabels(calls), [], 'and it waits on its approval like any other spec')
  assert.deepEqual(result.gates, [{ kind: 'spec-approval', issueId: 'FIX-2', pr: 8, settlingInFlight: null }])
})

check('ROUTE: a bug waiting at NEEDS_IMPLEMENTATION is not knocked back to NEEDS_SPEC', async () => {
  // The second wake for a bug the cap deferred: it sits at NEEDS_IMPLEMENTATION with no PR yet.
  // A direct row is unapproved BY CONSTRUCTION, so the approval-gate correction would read that as
  // "implementation phase without approval" and re-phase it to NEEDS_SPEC — where the wake authors
  // the very spec this route exists to skip, then re-derives `direct` and does it again next wake.
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-9', { route: 'direct', phase: 'NEEDS_IMPLEMENTATION' })] }),
    respond: epicResponder({
      fresh: { 'FIX-9': { phase: 'NEEDS_IMPLEMENTATION' } },
      linear: { 'FIX-9': { state: 'Todo', category: 'Bug' } },
      worker: { 'FIX-9': { phase: 'PR_FEEDBACK', implPr: 44 } },
    }),
  })
  assert.deepEqual(workerLabels(calls), ['implement:FIX-9'], 'it must implement, not go write a spec')
  assert.equal(result.issues[0].implPr, 44)
})

check('ROUTE: a bug whose PR already exists is not rebuilt', async () => {
  // A carried row still at NEEDS_SPEC (nothing has read its category yet) whose scan finds an open
  // implementation PR. For a spec-route row that report is a gate bypass and is refused; for a bug
  // there is no gate to bypass, and refusing it re-dispatches `implement` on work already under
  // review — a duplicate PR for the same fix.
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-9')] }),
    respond: epicResponder({
      fresh: { 'FIX-9': { phase: 'PR_FEEDBACK', implPr: 44, newPrEvents: true } },
      linear: { 'FIX-9': { state: 'In Review', category: 'Bug' } },
      worker: { 'FIX-9': { phase: 'PR_FEEDBACK', implPr: 44, prFeedbackRoundsSpent: 1 } },
    }),
  })
  assert.equal(result.issues[0].phase, 'PR_FEEDBACK', 'the scan\'s report stands — there was no gate to jump')
  assert.deepEqual(workerLabels(calls), ['pr-feedback:FIX-9'], 'handle the PR, do not open a second one')
})

check('ROUTE: removing the Bug label re-gates the issue', async () => {
  // Preserving the carried route on an observed-but-uncategorized row left a bug ungated after
  // its Bug label was removed — which is the one mutation a human makes precisely to re-gate it.
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-9', { route: 'direct', phase: 'NEEDS_IMPLEMENTATION' })] }),
    respond: epicResponder({
      fresh: { 'FIX-9': { phase: 'NEEDS_IMPLEMENTATION' } },
      linear: { 'FIX-9': { state: 'Todo', category: null } }, // the label is gone
    }),
  })
  assert.equal(result.issues[0].route, 'spec')
  assert.deepEqual(workerLabels(calls), ['spec:FIX-9'], 'it needs a spec now, not an implementation')
})

check('ROUTE: relabelling a bug mid-review re-routes it but does not re-gate it', async () => {
  // A spec-less bug relabelled Feature while its PR is open re-routes to `spec` — the label is
  // always the authority — but nothing demands a spec after the fact. The code exists and is under
  // review, so a spec written now settles nothing the PR review doesn't, and the row keeps its
  // merge gate rather than being knocked back to NEEDS_SPEC.
  //
  // The known residual, accepted deliberately (see the cross-spec comment in epic-wake.js): the
  // row is now a spec-route member with no spec document, so it counts toward the cross-spec set.
  // That costs a wasted read, and closing it needs a durable "was ever direct" field that a
  // relabel-mid-review does not earn.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-9', { route: 'direct', phase: 'PR_FEEDBACK', implPr: 44 })] }),
    respond: epicResponder({
      fresh: { 'FIX-9': { phase: 'PR_FEEDBACK', implPr: 44, readyToMerge: true } },
      linear: { 'FIX-9': { state: 'In Review', category: 'Feature' } }, // relabelled
    }),
  })
  const r9 = result.issues.find((r) => r.id === 'FIX-9')
  assert.equal(r9.route, 'spec', 'the label is always the authority on the route')
  assert.equal(r9.phase, 'PR_FEEDBACK', 'but the built work is not re-gated back to NEEDS_SPEC')
  assert.deepEqual(
    result.gates,
    [{ kind: 'merge', issueId: 'FIX-9', pr: 44 }],
    'it keeps the merge gate it already reached',
  )
})

check('ROUTE: a promoted bug stays promoted across wakes', async () => {
  // A worker that refused to build (no reproduction, or it is not really a bug) sends the row back
  // to the spec route. The Linear label still says Bug, so without stickiness the very next refresh
  // re-derives `direct` and undoes the promotion — every wake, forever.
  const first = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2')] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'NEEDS_SPEC' } },
      linear: { 'FIX-2': { state: 'Todo', category: 'Bug' } },
      worker: { 'FIX-2': { phase: 'NEEDS_SPEC', specRequired: 'no reproduction and the symptom is ambiguous' } },
    }),
  })
  assert.equal(first.result.issues[0].specRequired, 'no reproduction and the symptom is ambiguous')
  // The promotion is INTERNAL work: the row is now at NEEDS_SPEC with no PR, so nothing external
  // can ever wake it. Without this the coordinator ends its turn and the spec waits for a
  // heartbeat — and the second `run()` below would mask exactly that, since it starts a wake the
  // coordinator would not have known to start.
  assert.equal(first.result.moreWorkNow, true, 'a promoted row must drain, not wait for the heartbeat')

  const second = await run('epic-wake.js', {
    args: epicArgs({ issues: [first.result.issues[0]] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'NEEDS_SPEC' } },
      linear: { 'FIX-2': { state: 'Todo', category: 'Bug' } }, // still labelled Bug
    }),
  })
  assert.equal(second.result.issues[0].route, 'spec')
  assert.deepEqual(workerLabels(second.calls), ['spec:FIX-2'], 'the promotion has to survive the re-derivation')
  assert.match(second.logs.join('\n'), /FIX-2: promoted back to the spec route — no reproduction/)
})

check('ROUTE: the cross-spec pass neither waits for a bug nor holds one', async () => {
  // Two failures in opposite directions, and both come from letting a spec-less row into the set.
  // Counted as "still coming", its spec never arrives and the pass is never askable — every feature
  // in the epic deadlocks behind a bug. Held by the pass, a bug waits on a coherence check about
  // documents it does not have.
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 }), // feature, approved this wake
        row('FIX-3'), // feature, spec still to be written → the pass is not askable yet
        row('FIX-9'), // bug
      ],
    }),
    respond: epicResponder({
      fresh: {
        'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8, specApproved: true },
        'FIX-3': { phase: 'NEEDS_SPEC' },
        'FIX-9': { phase: 'NEEDS_SPEC' },
      },
      linear: { 'FIX-9': { state: 'Todo', category: 'Bug' } },
      worker: { 'FIX-9': { phase: 'PR_FEEDBACK', implPr: 44 } },
    }),
  })
  const dispatched = workerLabels(calls)
  assert.ok(!dispatched.includes('implement:FIX-2'), 'the approved feature waits for the coherence pass')
  assert.ok(dispatched.includes('implement:FIX-9'), 'the bug does not — it has no spec to be incoherent with')
  assert.equal(result.crossSpecGate, undefined, 'and the bug is not counted as a spec still to arrive')
})

check('ROUTE: one spec plus a bug is not a set to check for coherence', async () => {
  // Counting a bug as a member of the spec set makes the hold engage on an epic that has only ONE
  // spec in it — so the single approved feature is parked waiting on a coherence pass with nothing
  // to compare it against, and the human is asked to run one. "One spec has nothing to be
  // incoherent with" is the rule; a row with no spec at all cannot make it two.
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 }), row('FIX-9')],
    }),
    respond: epicResponder({
      fresh: {
        'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8, specApproved: true },
        'FIX-9': { phase: 'NEEDS_SPEC' },
      },
      linear: { 'FIX-9': { state: 'Todo', category: 'Bug' } },
      worker: {
        'FIX-2': { phase: 'PR_FEEDBACK', implPr: 41 },
        'FIX-9': { phase: 'PR_FEEDBACK', implPr: 44 },
      },
    }),
  })
  assert.deepEqual(workerLabels(calls).sort(), ['implement:FIX-2', 'implement:FIX-9'])
  assert.equal(result.crossSpecGate, undefined, 'no pass should be asked for over a single spec')
})

check('ROUTE: the epic objective gate still holds a bug', async () => {
  // The direct route removes the SPEC gate, not the epic's. A bug under an unapproved epic waits
  // like everything else — it just waits at implementation instead of at spec.
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-9')] }),
    respond: epicResponder({
      approved: false,
      fresh: { 'FIX-9': { phase: 'NEEDS_SPEC' } },
      linear: { 'FIX-9': { state: 'Todo', category: 'Bug' } },
    }),
  })
  assert.deepEqual(workerLabels(calls), [], 'no bug is built before the epic objective is signed off')
  assert.deepEqual(result.held, ['FIX-9'])
  assert.equal(result.issues[0].phase, 'NEEDS_IMPLEMENTATION', 'held at its own entry phase, not at NEEDS_SPEC')
})

check('INVARIANT: worker-facing docs never name a field the result schema rejects', async () => {
  // Both round-3 defects were this one gap, two lines apart: the dispatch prompt asked for `route`
  // (absent from WORKER_SCHEMA) and issue-worker.md documented `spec_required` / `specRequired:
  // none`. `additionalProperties: false` means a worker that obeys either fails validation AFTER
  // doing the work, and the `"none"` sentinel is worse — it validates, and then sticky-promotes
  // every ordinary bug onto the spec route. Nothing connected the prose to the schema, so nothing
  // caught it.
  const src = readFileSync(join(HERE, 'epic-wake.js'), 'utf8')
  const at = src.indexOf('const WORKER_SCHEMA =')
  const body = src.slice(at, src.indexOf('const EPIC_FOLD_SCHEMA ='))
  const declared = new Set([...body.matchAll(/^    ([a-zA-Z][a-zA-Z0-9]*):/gm)].map((m) => m[1]))
  assert.ok(declared.has('specRequired'), 'the promotion field must be declared')
  assert.ok(!declared.has('route'), 'the route is derived by the coordinator, never reported')

  const worker = readFileSync(join(HERE, '..', 'subagents', 'issue-worker.md'), 'utf8')
  assert.ok(!/spec_required/.test(worker), 'snake_case spelling is rejected by the schema')
  assert.ok(
    !/specRequired:\s*none/.test(worker),
    '"none" is truthy — it validates and then promotes every direct bug onto the spec route',
  )
  // The status-line block must not offer a key for a field the schema owns, which is how the
  // snake_case spelling got written in the first place.
  const returnBlock = worker.slice(worker.indexOf('## Return format'))
  for (const field of ['specRequired', 'route']) {
    assert.ok(
      !new RegExp(`^${field}:`, 'm').test(returnBlock),
      `${field} is a schema field (or not a field at all) — it must not appear as a status-line key`,
    )
  }
  // ...and neither may the PROSE instruct a return of one. Scoping the previous version of this
  // check to the return-format block missed a "Return `route: direct`" left in the body — which
  // then sat two paragraphs above the sentence telling the worker NOT to report the route. A
  // contradiction is worse than either instruction alone, since which one wins is a coin flip.
  assert.ok(
    !/[Rr]eturn\s+`?route:/.test(worker),
    'no instruction anywhere may tell a worker to return `route` — the schema rejects it after the work is done',
  )
})

check('INVARIANT: nothing routes an issue past the spec gate except an actual Bug label', async () => {
  // The direct route is the only path to code with no human sign-off in front of it, so the ONE
  // property worth checking over the whole input space is that nothing else opens it. Asserted as a
  // property rather than a truth table on purpose: a table restating the implementation agrees with
  // whatever the implementation does, including a wrong `||` that leaks `direct` out of an
  // unreadable scan.
  const { routeFor, isDirectRoute, directRoutePhase, PRE_APPROVAL_PHASES } = loadRules('epic-wake.js', [
    'atReviewBudget',
    'routeFor',
    'isDirectRoute',
    'directRoutePhase',
    'PRE_APPROVAL_PHASES',
  ])

  const cases = product({
    carried: [undefined, 'spec', 'direct'],
    specRequired: [null, 'not really a bug'],
    observed: [true, false],
    category: [null, '', 'Bug', 'bug', 'bugs', 'Feature', 'Enhancement', 'Improvement', 'Debug'],
    specPr: [null, 8],
  })

  for (const c of cases) {
    const route = routeFor({ route: c.carried, specRequired: c.specRequired }, { category: c.category }, c.observed, c.specPr)
    assert.ok(route === 'spec' || route === 'direct', `routeFor returned ${route}`)

    const bugLabel = c.observed && /^bugs?$/i.test((c.category || '').trim())
    if (route === 'direct') {
      // Every clause that must be able to veto the label, checked from the outside.
      // A CARRIED direct route survives only when nothing was observed — see the pair of
      // assertions below, which are the whole difference between "we didn't look" and
      // "we looked and there is no label".
      assert.ok(bugLabel || (!c.observed && c.carried === 'direct'), `direct route with no bug label: ${JSON.stringify(c)}`)
      assert.equal(c.specPr, null, `an existing spec PR must keep the issue on the spec route: ${JSON.stringify(c)}`)
      assert.equal(c.specRequired, null, `a promotion must be sticky: ${JSON.stringify(c)}`)
    }
    // "Debug" and "" must not read as a bug — a substring or truthiness test would pass them.
    if (!bugLabel && !c.specPr && !c.specRequired && !(!c.observed && c.carried === 'direct')) {
      assert.equal(route, 'spec', `non-bug input routed direct: ${JSON.stringify(c)}`)
    }
    // The two halves of "observed" spelled out, because they are opposite answers to the same
    // missing field and an implementation that conflates them is the failure Codex found:
    // an OBSERVED row with no category fails CLOSED (its Bug label was removed — the very
    // mutation a human makes to re-gate it), while an UNOBSERVED row (a dead scout) keeps what
    // it had, since re-routing on an infrastructure failure would thrash a live row.
    if (c.observed && !(c.category || '').trim() && !c.specPr && !c.specRequired) {
      assert.equal(route, 'spec', `an observed row with no category must fail closed: ${JSON.stringify(c)}`)
    }
    if (!c.observed && !c.specPr && !c.specRequired) {
      assert.equal(route, c.carried || 'spec', `a dead scan must preserve the carried route: ${JSON.stringify(c)}`)
    }
  }

  // And the phase correction only ever moves a direct row FORWARD out of the spec phases — never
  // back into them, and never for a spec-route row.
  for (const phase of ['NEEDS_SPEC', 'AWAITING_SPEC_APPROVAL', 'NEEDS_IMPLEMENTATION', 'PR_FEEDBACK', 'DONE']) {
    assert.equal(directRoutePhase({ route: 'spec', phase }), null, 'a spec-route row is never re-phased by the route rule')
    const corrected = directRoutePhase({ route: 'direct', phase })
    assert.equal(
      corrected,
      PRE_APPROVAL_PHASES.has(phase) ? 'NEEDS_IMPLEMENTATION' : null,
      `directRoutePhase mis-handled ${phase}`,
    )
  }
  assert.equal(isDirectRoute({ route: 'direct' }), true)
  assert.equal(isDirectRoute({}), false, 'an absent route is never direct')
})

check('the epic itself is never added as one of its own children', async () => {
  const { result } = await run('epic-wake.js', {
    args: epicArgs({ issues: [] }),
    respond: (prompt, opts) => {
      const label = opts.label || ''
      if (label === 'gate:epic') return { approved: true, approvedByLabel: false, headSha: 'abc', newReviewEvents: false, latestActivityAt: null }
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
      if (label === 'gate:epic') return { approved: true, approvedByLabel: false, headSha: 'abc', newReviewEvents: true, latestActivityAt: 'new' }
      if (label === 'linear:epic-children') return { issues: [] }
      if (label === 'fold:epic') return { roundsSpent: 0, aboveBar: false, folded: 'recorded the verdict', fanOut: [] }
      if (label === 'route:epic-notes') return { notes: [{ summary: 'rename the helper', fanOut: ['FIX-2'] }] }
      return null
    },
  })
  assert.deepEqual(labels(calls, 'fold:epic'), ['fold:epic'], 'the verdict still folds')
  assert.deepEqual(labels(calls, 'route:epic-notes'), ['route:epic-notes'], 'and the ordinary feedback still routes')
  const foldPrompt = calls.find((c) => c.label === 'fold:epic').prompt
  assert.match(foldPrompt, /Fold what is listed above and NOTHING ELSE/)
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
  assert.match(p, /Fold what is listed above and NOTHING ELSE/)
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
  // A `pr-feedback` row does not author against the objective, so it keeps its priority and the fold
  // waits. (A `spec` or `implement` row is held for the fold instead — the check below.)
  const { calls, logs } = await run('epic-wake.js', {
    args: epicArgs({
      cap: 1,
      epic: { issueId: 'FIX-1', branch: 'epic/t', prNumber: 100, reviewRounds: 0 },
      issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9 })],
    }),
    respond: epicResponder({ epicReviewEvents: true, fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', newPrEvents: true, implPr: 9 } } }),
  })
  assert.equal(workerLabels(calls).length, 1)
  assert.deepEqual(labels(calls, 'fold:epic'), [])
  assert.match(logs.join('\n'), /epic-spec fold queued behind the issue workers/)
})

check('the fold takes a slot inside the cap, never a slot beyond it', async () => {
  // The cap is documented as shared across issue workers, folds and settlements, and an epic-agent
  // fold is a full worktree like any other — reserving its slot has to displace an advance.
  const { calls, logs } = await run('epic-wake.js', {
    args: epicArgs({
      cap: 2,
      epic: { issueId: 'FIX-1', branch: 'epic/t', prNumber: 100, reviewRounds: 0 },
      issues: [
        row('FIX-2'), // a spec — held for the fold
        row('FIX-3', { phase: 'PR_FEEDBACK', implPr: 9 }),
        row('FIX-4', { phase: 'PR_FEEDBACK', implPr: 10 }),
      ],
    }),
    respond: epicResponder({
      epicReviewEvents: true,
      fresh: {
        'FIX-2': { phase: 'NEEDS_SPEC' },
        'FIX-3': { phase: 'PR_FEEDBACK', newPrEvents: true, implPr: 9 },
        'FIX-4': { phase: 'PR_FEEDBACK', newPrEvents: true, implPr: 10 },
      },
    }),
  })
  const jobs = workerLabels(calls).length + labels(calls, 'fold:epic').length
  assert.equal(jobs, 2, `cap 2 must mean 2 jobs, ran ${jobs}`)
  assert.deepEqual(labels(calls, 'fold:epic'), ['fold:epic'], 'the fold gets its reserved slot')
  assert.equal(workerLabels(calls).length, 1, 'and one advance is displaced to make room')
  assert.match(logs.join('\n'), /Cap 2 reached — deferring/)
})

check('work that authors against the objective is held for one wake while it folds', async () => {
  // A spec or an implementation written against an objective this wake is revising starts from
  // direction that is about to change. Held ONE wake, not re-gated — the approval stays intact.
  const { calls, logs, result } = await run('epic-wake.js', {
    args: epicArgs({
      epic: { issueId: 'FIX-1', branch: 'epic/t', prNumber: 100, reviewRounds: 0 },
      issues: [row('FIX-2'), row('FIX-3', { phase: 'PR_FEEDBACK', implPr: 9 })],
    }),
    respond: epicResponder({
      epicReviewEvents: true,
      fresh: { 'FIX-2': { phase: 'NEEDS_SPEC' }, 'FIX-3': { phase: 'PR_FEEDBACK', newPrEvents: true, implPr: 9 } },
    }),
  })
  assert.deepEqual(workerLabels(calls), ['pr-feedback:FIX-3'], 'only the non-authoring row runs')
  assert.deepEqual(labels(calls, 'fold:epic'), ['fold:epic'], 'and the fold it is waiting for takes priority')
  assert.match(logs.join('\n'), /Holding FIX-2\(spec\) for one wake/)
  assert.equal(result.issues.find((r) => r.id === 'FIX-2').phase, 'NEEDS_SPEC', 'the held row is unchanged')

  // Next wake, with the fold consumed, it dispatches.
  const second = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2')] }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'NEEDS_SPEC' } } }),
  })
  assert.deepEqual(workerLabels(second.calls), ['spec:FIX-2'])
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

check('a refresh scan echoing a sibling id is discarded, not bound to the wrong row', async () => {
  const { result, logs } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7 }), row('FIX-3', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 })],
    }),
    // FIX-3's scout reports FIX-2's id along with an approval. Keying on the reported value would
    // land that approval on FIX-2 and start implementing a spec the human approved for FIX-3.
    respond: (prompt, opts) => {
      const label = opts.label || ''
      if (label === 'gate:epic') return { approved: true, approvedByLabel: false, headSha: 'abc', newReviewEvents: false, latestActivityAt: '2026-07-05T00:00:00Z' }
      if (label === 'linear:epic-children') return { issues: [] }
      if (label === 'refresh:FIX-2') return { issueId: 'FIX-2', ...freshRow({ phase: 'AWAITING_SPEC_APPROVAL', specPr: 7 }) }
      if (label === 'refresh:FIX-3') return { issueId: 'FIX-2', ...freshRow({ phase: 'AWAITING_SPEC_APPROVAL', specApproved: true, specPr: 8 }) }
      return workerRes({ issueId: label.split(':')[1] })
    },
  })
  const two = result.issues.find((r) => r.id === 'FIX-2')
  const three = result.issues.find((r) => r.id === 'FIX-3')
  assert.equal(two.specApproved, false, "FIX-2 must not inherit FIX-3's approval")
  assert.equal(three.specApproved, false, 'a discarded scan fails closed on the row that requested it')
  assert.match(logs.join('\n'), /refresh:FIX-3 reported issueId FIX-2 — discarding the scan/)
})

check('a worker echoing a sibling id is discarded and its settle request does not fan', async () => {
  const { result, logs } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2'), row('FIX-3')] }),
    respond: (prompt, opts) => {
      const label = opts.label || ''
      if (label === 'gate:epic') return { approved: true, approvedByLabel: false, headSha: 'abc', newReviewEvents: false, latestActivityAt: '2026-07-05T00:00:00Z' }
      if (label === 'linear:epic-children') return { issues: [] }
      if (label.startsWith('refresh:')) return { issueId: label.slice('refresh:'.length), ...freshRow() }
      // FIX-3's worker reports FIX-2's id, and raises a claim while it's at it.
      if (label === 'spec:FIX-3') {
        return workerRes({ issueId: 'FIX-2', phase: 'AWAITING_SPEC_APPROVAL', specPr: 8, settleRequested: { claim: 'c', load: 'x', falsify: 'y', threads: 't' } })
      }
      return workerRes({ issueId: 'FIX-2', phase: 'AWAITING_SPEC_APPROVAL', specPr: 7 })
    },
  })
  const two = result.issues.find((r) => r.id === 'FIX-2')
  const three = result.issues.find((r) => r.id === 'FIX-3')
  assert.equal(two.specPr, 7, "FIX-2 keeps its own worker's handle")
  assert.equal(three.phase, 'NEEDS_SPEC', 'a discarded worker leaves its row un-advanced, to retry next wake')
  assert.deepEqual(result.settleRequests, [], 'and its claim is not attributed to the issue it echoed')
  assert.match(logs.join('\n'), /worker for FIX-3 reported issueId FIX-2 — discarding the result/)
})

check('an INCONCLUSIVE issue verdict becomes a durable human decision, not a fold loop', async () => {
  const { result, logs } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7, verdicts: [{ claim: 'does X stream?', verdict: 'INCONCLUSIVE', evidence: 'could not reproduce' }] })],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7 } },
      worker: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7 } },
    }),
  })
  const two = result.issues[0]
  assert.deepEqual(two.verdicts, [], 'it leaves the field that drives dispatch — otherwise a folder runs every wake forever')
  assert.match(two.blocker, /INCONCLUSIVE — needs a human decision: does X stream\?/)
  assert.ok(
    result.blockers.some((b) => b.issueId === 'FIX-2' && /does X stream/.test(b.blocker)),
    'and is surfaced to the human rather than dropped',
  )
  assert.ok(!/re-dispatch/.test(logs.join('\n')))

  // Next wake: the blocker parks the row, so nothing is dispatched and the decision persists.
  const second = await run('epic-wake.js', {
    args: epicArgs({ issues: [{ ...two }] }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7 } } }),
  })
  assert.deepEqual(workerLabels(second.calls), [], 'a row awaiting a human decision dispatches nothing')
  assert.match(second.result.issues[0].blocker, /needs a human decision/, 'and the decision survives the wake')
})

check('an INCONCLUSIVE issue verdict keeps its evidence for the human', async () => {
  // The blocker text carries the claim; the coordinator is told to put the question WITH what the POC
  // found, and the threads are where the answer gets posted. Both have to survive the fold.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'AWAITING_SPEC_APPROVAL',
          specPr: 7,
          verdicts: [{ claim: 'does X stream?', verdict: 'INCONCLUSIVE', evidence: 'ran it twice, non-deterministic', threads: 't7' }],
        }),
      ],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7 } },
      worker: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7 } },
    }),
  })
  const rec = (result.issues[0].unsettled || [])[0]
  assert.ok(rec, 'a structured record survives, not just the blocker text')
  assert.equal(rec.evidence, 'ran it twice, non-deterministic')
  assert.equal(rec.threads, 't7')
  assert.ok(
    result.unsettled.some((u) => u.issueId === 'FIX-2' && u.unsettled[0].evidence === 'ran it twice, non-deterministic'),
    'and it is surfaced to the coordinator',
  )
})

check('an INCONCLUSIVE epic verdict stops re-triggering the fold and stays surfaced', async () => {
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      epic: { issueId: 'FIX-1', branch: 'epic/t', prNumber: 100, reviewRounds: 0, verdicts: [{ claim: 'shared claim', verdict: 'INCONCLUSIVE', evidence: 'ran it, ambiguous' }] },
      issues: [],
    }),
    respond: epicResponder({}),
  })
  assert.deepEqual(result.epic.verdicts, [], 'a consumed INCONCLUSIVE leaves the field foldEpicWanted reads')
  assert.deepEqual(
    result.epic.unsettled.map((u) => u.claim),
    ['shared claim'],
    'it becomes durable epic state instead',
  )
  assert.ok(result.blockers.some((b) => b.issueId === 'FIX-1' && /shared claim/.test(b.blocker)))

  // Next wake: no verdict to fold, so no epic-agent worktree is spent — and the decision is
  // re-surfaced rather than shown once and forgotten.
  const second = await run('epic-wake.js', {
    args: epicArgs({ epic: { ...result.epic }, issues: [] }),
    respond: epicResponder({}),
  })
  assert.deepEqual(labels(second.calls, 'fold:epic'), [], 'a verdict no fold can consume must not dispatch one')
  assert.ok(second.result.blockers.some((b) => /shared claim/.test(b.blocker)), 'and it is still surfaced')
  assert.equal(second.result.epic.unsettled.length, 1, 'recorded once, not duplicated each wake')
})

check('a quiet round two revokes the third round that round one authorized', async () => {
  // The canonical rule is "spend a third round only when ROUND TWO surfaced a genuine spec-level
  // finding" (orchestration.md § The convergence rule). A review round's answer is therefore
  // authoritative in both directions — carrying round one's `true` through a quiet round two
  // authorizes a third round the rule does not.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7, specReviewRounds: 1, specLevelFound: true })],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', newSpecReviewEvents: true, specPr: 7 } },
      // Round two reports the round it spent and omits the optional flag: it found nothing.
      worker: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7, specReviewRoundsSpent: 1 } },
    }),
  })
  assert.equal(result.issues[0].specReviewRounds, 2)
  assert.equal(result.issues[0].specLevelFound, false, "a review round's silence means it found nothing")

  // So the next wake converges instead of spending a third round.
  const second = await run('epic-wake.js', {
    args: epicArgs({ issues: [{ ...result.issues[0] }] }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', newSpecReviewEvents: true, specPr: 7 } } }),
  })
  assert.deepEqual(workerLabels(second.calls), [], 'converged — no third round')
})

check('a non-review worker still cannot revoke an authorized third round', async () => {
  // The other half of the same rule: an apply-verdict fold is not a review round, so its silence
  // must PRESERVE the flag. Both halves have to hold at once, which is why the rule keys on the
  // action rather than on whether the field was reported.
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
      worker: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7 } },
    }),
  })
  assert.equal(result.issues[0].specLevelFound, true, 'an apply-verdict fold reports nothing about review findings')
})

check('a verdict-only epic fold cannot revoke the epic third round', async () => {
  // `aboveBar` is REQUIRED, so a verdict-only fold must report something and reports false. Keyed
  // on `roundsSpent`, that zero-round fold preserves the flag instead of revoking it.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      epic: {
        issueId: 'FIX-1',
        branch: 'epic/t',
        prNumber: 100,
        reviewRounds: 2,
        aboveBarFound: true,
        verdicts: [{ claim: 'c', verdict: 'CONFIRMED', evidence: 'e' }],
      },
      issues: [],
    }),
    respond: epicResponder({ fold: { roundsSpent: 0, aboveBar: false } }),
  })
  assert.equal(result.epic.aboveBarFound, true, 'a fold that spent no round is not a review round')
  assert.equal(result.epic.reviewRounds, 2)
})

check('a verdict fold that escalated a decision keeps the verdict', async () => {
  // Returning is not the same as finishing. A folder that hit an undecided fork returns a
  // `blocker`; counting that as a fold deletes the row's only copy of the claim, evidence and owed
  // thread reply AND parks the row — so once the human answers there is nothing left to apply.
  const { result, logs } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'AWAITING_SPEC_APPROVAL',
          specPr: 7,
          verdicts: [{ claim: 'does X stream?', verdict: 'REFUTED', evidence: 'ran it', threads: 't' }],
        }),
      ],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7 } },
      worker: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7, blocker: 'which behaviour do we want?' } },
    }),
  })
  assert.equal(result.issues[0].verdicts.length, 1, 'an escalated fold consumes nothing')
  assert.equal(result.issues[0].verdicts[0].evidence, 'ran it', 'and the evidence survives for the retry')
  assert.match(result.issues[0].blocker, /which behaviour/)
  assert.match(logs.join('\n'), /the verdict fold escalated a decision/)
})

check('a review worker that reports no round count is still charged one', async () => {
  // `specReviewRoundsSpent` is optional, so an omission charged zero would consume the feedback,
  // advance the cursor, and never reach the budget — an unbounded review sequence.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7, specReviewRounds: 1 })] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', newSpecReviewEvents: true, specPr: 7 } },
      worker: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7 } },
    }),
  })
  assert.equal(result.issues[0].specReviewRounds, 2, 'an unreported round is assumed spent')
})

check('an explicit zero-round review batch still costs nothing', async () => {
  // The other side of the same rule: the canonical zero-cost factual batch has to survive.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7, specReviewRounds: 1 })] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', newSpecReviewEvents: true, specPr: 7 } },
      worker: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7, specReviewRoundsSpent: 0 } },
    }),
  })
  assert.equal(result.issues[0].specReviewRounds, 1, 'a batch of only factual corrections is free')
})

check('an in-session approval releases the issue when no PR artifact exists', async () => {
  // The documented second channel: "the user saying 'approved' in-session". No comment or review
  // exists for a scout to find, so a scan-only rule would hold the issue forever.
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7, approvedInSession: 'head1' })],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specApproved: false, specPr: 7, headSha: 'head1' } },
      worker: { 'FIX-2': { phase: 'NEEDS_IMPLEMENTATION', specPr: 7 } },
    }),
  })
  assert.deepEqual(workerLabels(calls), ['implement:FIX-2'], 'a satisfied gate is a release, not a stop')
  assert.deepEqual(
    result.gates.filter((g) => g.kind === 'spec-approval'),
    [],
    'and the human is not asked to approve again',
  )
})

check('an in-session approval does not survive a later push', async () => {
  // It carries the head it was given for, so it gets the same staleness rule as a scan approval.
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7, approvedInSession: 'head1' })],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specApproved: false, specPr: 7, headSha: 'head2' } },
    }),
  })
  assert.deepEqual(workerLabels(calls), [], 'a push after the human spoke invalidates it')
  assert.ok(result.gates.some((g) => g.kind === 'spec-approval' && g.issueId === 'FIX-2'))
})

check("a multi-PR issue's sub-PR handles survive the epic wake", async () => {
  // One `implPr` cannot hold a DAG. Without the passthrough the coordinator can't subscribe to the
  // sub-PRs the worker just opened, and their review/CI/merge events are invisible for the epic.
  const subPrs = [
    { id: 'a', status: 'open', pr: 41, branch: 'fix/FIX-2-a', stackedOn: null },
    { id: 'b', status: 'pending', pr: null, branch: null, stackedOn: null },
  ]
  const { result } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'NEEDS_IMPLEMENTATION' })] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'NEEDS_IMPLEMENTATION', specApproved: true } },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', subPrs } },
    }),
  })
  assert.deepEqual(result.issues[0].subPrs, subPrs)

  // And a later worker that says nothing about them must not clear them.
  const second = await run('epic-wake.js', {
    args: epicArgs({ issues: [{ ...result.issues[0] }] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', newPrEvents: true } },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK' } },
    }),
  })
  assert.deepEqual(second.result.issues[0].subPrs, subPrs, 'only a worker that reported a table replaces it')
})

check('a POC that paraphrases the claim settles the claim that was requested', async () => {
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7 })],
      settleRequests: [{ claim: 'does the router re-enter?', load: 'x', falsify: 'y', threads: 't', issueId: 'FIX-2' }],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7 } },
      // The POC answers a differently-worded — or entirely different — claim.
      poc: { claim: 'something else entirely', verdict: 'CONFIRMED', evidence: 'ran it' },
    }),
  })
  const landed = result.issues[0].verdicts
  assert.equal(landed.length, 1)
  assert.equal(landed[0].claim, 'does the router re-enter?', 'the requested claim is what gets folded and replied to')
})

check('a review worker that escalates does not consume the batch it never finished', async () => {
  // Same rule as the verdict fold: returning is not finishing. If the batch is consumed, the cursor
  // advances and the flags clear, so once the human answers and the coordinator clears the blocker
  // there is no pending event left — the feedback and the work waiting on that decision are gone.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7, lastSeenActivityAt: 'old' })],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', newSpecReviewEvents: true, specPr: 7, latestActivityAt: 'new' } },
      worker: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7, blocker: 'which approach do we want?' } },
    }),
  })
  const two = result.issues[0]
  assert.equal(two.lastSeenActivityAt, 'old', 'the cursor holds for a batch nobody finished reading')
  assert.equal(two.newSpecReviewEvents, true, 'and the flag stays live so the batch is re-derived')
  assert.match(two.blocker, /which approach/)
})

check('approval arriving with fresh feedback implements AND carries the feedback', async () => {
  // Approval wins — never hold an approved issue. But the row is about to become PR_FEEDBACK, whose
  // machine never looks at spec-PR activity again, so this dispatch is the only pass that can see
  // the batch. It is told to carry it as implementer notes, and it consumes it.
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7, lastSeenActivityAt: 'old' })],
    }),
    respond: epicResponder({
      fresh: {
        'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specApproved: true, newSpecReviewEvents: true, specPr: 7, latestActivityAt: 'new' },
      },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9, specPr: 7 } },
    }),
  })
  assert.deepEqual(workerLabels(calls), ['implement:FIX-2'], 'approval still releases the issue')
  const prompt = calls.find((c) => c.label === 'implement:FIX-2').prompt
  assert.match(prompt, /ALSO carries outstanding review feedback/)
  assert.match(prompt, /carry it as implementer notes BEFORE you close the spec PR/)
  assert.equal(result.issues[0].lastSeenActivityAt, 'new', 'and the batch is consumed by the pass that read it')
  assert.equal(result.issues[0].newSpecReviewEvents, false)
})

check('child spec gates are withheld while the objective gate is closed', async () => {
  // A human approving a child spec aligned to an objective mid-revision leaves a stale approval
  // that releases implementation once the epic is re-approved, with no second alignment gate.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7 })] }),
    respond: epicResponder({ approved: false, fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7 } } }),
  })
  assert.deepEqual(result.gates, [{ kind: 'epic-objective', pr: 100 }], 'the objective is the only gate that can move')

  // And they come back the moment it stands again.
  const second = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7 })] }),
    respond: epicResponder({ approved: true, fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7 } } }),
  })
  assert.ok(second.result.gates.some((g) => g.kind === 'spec-approval' && g.issueId === 'FIX-2'))
})

check("a multi-PR issue's assemble state and sub-PR handles both survive", async () => {
  // `subPrs` alone is not enough: the assemble phase is a multi-wake machine that resumes from
  // these handles, so losing them re-runs the goal and files a duplicate gap issue every wake.
  const subPrs = [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a', stackedOn: null }]
  const assembledGoal = { passed: false, failure: 'stream closed early', evidence: 'ran it', fixIssue: 'FIX-50', fixPr: 77, fixMerged: false }
  const { result } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'NEEDS_IMPLEMENTATION' })] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'NEEDS_IMPLEMENTATION', specApproved: true } },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', subPrs, assembledGoal } },
    }),
  })
  assert.deepEqual(result.issues[0].assembledGoal, assembledGoal)

  // A later worker silent about them must not restart the machine.
  const second = await run('epic-wake.js', {
    args: epicArgs({ issues: [{ ...result.issues[0] }] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', newPrEvents: true } },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK' } },
    }),
  })
  assert.deepEqual(second.result.issues[0].assembledGoal, assembledGoal, 'only a worker that reported it replaces it')
})

check("a multi-PR issue's refresh scout is given every sub-PR to read", async () => {
  // With no single `implPr`, a scout told "Impl PR: none" has nothing to read: a subscribed sub-PR
  // event wakes the coordinator and the row still reports no activity, stuck in PR_FEEDBACK.
  const { calls } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          subPrs: [
            { id: 'a', status: 'open', pr: 41, branch: 'fix/a' },
            { id: 'b', status: 'pending', pr: null, branch: null },
          ],
        }),
      ],
    }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'PR_FEEDBACK' } } }),
  })
  const refresh = calls.find((c) => c.label === 'refresh:FIX-2').prompt
  assert.match(refresh, /a=#41 \(open\)/)
  assert.match(refresh, /b=not opened \(pending\)/)
  assert.match(refresh, /report activity, CI and merge state across ALL of them/)
})

check('a multi-PR row surfaces a merge gate per green sub-PR, with its own PR number', async () => {
  // An aggregate `readyToMerge` is not actionable: these rows have no `implPr`, so one gate per row
  // carried `pr: null` and the DAG stopped at its first merge-ready slice.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          subPrs: [
            { id: 'a', status: 'open', pr: 41, branch: 'fix/a' },
            { id: 'b', status: 'open', pr: 42, branch: 'fix/b' },
            { id: 'c', status: 'merged', pr: 40, branch: 'fix/c' },
          ],
        }),
      ],
    }),
    respond: epicResponder({
      fresh: {
        'FIX-2': {
          phase: 'PR_FEEDBACK',
          subPrStates: [
            { id: 'a', merged: false, readyToMerge: true },
            { id: 'b', merged: false, readyToMerge: false },
            { id: 'c', merged: true, readyToMerge: false },
          ],
        },
      },
    }),
  })
  assert.deepEqual(result.gates, [{ kind: 'merge', issueId: 'FIX-2', pr: 41, subPr: 'a' }])
  assert.ok(
    result.gates.every((g) => g.pr),
    'a merge gate with no PR number cannot be surfaced',
  )

  // ...and the same gate is produced when the scan answers those handles in its own order. The merge
  // FOLD was converted to id-binding while this second consumer of `subPrStates` stayed positional, so
  // a reordered scan folded correctly and then produced no gate at all: the green slice was never
  // offered for merge, and a scout that consistently orders that way parks the DAG for good.
  const reordered = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          subPrs: [
            { id: 'a', status: 'open', pr: 41, branch: 'fix/a' },
            { id: 'b', status: 'open', pr: 42, branch: 'fix/b' },
          ],
        }),
      ],
    }),
    respond: epicResponder({
      fresh: {
        'FIX-2': {
          phase: 'PR_FEEDBACK',
          subPrStates: [
            { id: 'b', merged: false, readyToMerge: false },
            { id: 'a', merged: false, readyToMerge: true },
          ],
        },
      },
    }),
  })
  assert.deepEqual(reordered.result.gates, [{ kind: 'merge', issueId: 'FIX-2', pr: 41, subPr: 'a' }])
})

check('a child spec review is held while the epic-spec is being folded', async () => {
  // `spec` and `implement` were held because they author against the objective; `spec-review` was not,
  // because the set was built from "creates a spec" rather than "writes against the objective".
  // Folding review feedback into an existing spec is authoring, and it is the expensive one to get
  // wrong: the worker is aligned to the pre-fold head and SPENDS A REVIEW ROUND against direction the
  // fold may be replacing, and a round is not refundable.
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({
      epic: { issueId: 'FIX-1', name: 'thing', branch: 'epic/thing', prNumber: 100, reviewRounds: 0, lastSeenActivityAt: 'old' },
      issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8, specReviewRounds: 0, lastSeenActivityAt: 'old' })],
    }),
    respond: epicResponder({
      epicReviewEvents: true,
      fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8, newSpecReviewEvents: true, latestActivityAt: 'new' } },
    }),
  })
  assert.deepEqual(labels(calls, 'fold:epic'), ['fold:epic'], 'the epic fold runs')
  assert.deepEqual(workerLabels(calls), [], 'and the child spec-review does not run alongside it')
  assert.deepEqual(result.heldForFold, [{ issueId: 'FIX-2', action: 'spec-review' }])
  assert.equal(result.issues[0].specReviewRounds, 0, 'a held review spends no round')
  assert.equal(result.issues[0].lastSeenActivityAt, 'old', 'and keeps its cursor, so the batch survives')
})

check('a merged sub-PR is folded into the durable table so the rebase gets scheduled', async () => {
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'PR_FEEDBACK', subPrs: [{ id: 'a', status: 'open', pr: 41, branch: 'fix/a' }] })],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', subPrStates: [{ id: 'a', merged: true, readyToMerge: false }] } },
    }),
  })
  assert.equal(result.issues[0].subPrs[0].status, 'merged', 'issue-multi-pr schedules the dependent rebase off this')

  // And a scan that says nothing about a sub-PR must never demote it — that would rebuild it.
  const second = await run('epic-wake.js', {
    args: epicArgs({ issues: [{ ...result.issues[0] }] }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', subPrStates: [] } } }),
  })
  assert.equal(second.result.issues[0].subPrs[0].status, 'merged')
})

check('a merged repair PR re-arms the assembled goal instead of waiting forever', async () => {
  // The repair PR lives outside `subPrs`, so nothing else can ever set `fixMerged` — the DAG sits
  // in AWAITING_FIX and never re-runs the goal it still has to prove.
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          subPrs: [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a' }],
          assembledGoal: { passed: false, failure: 'stream closed early', fixIssue: 'FIX-50', fixPr: 77, fixMerged: false },
        }),
      ],
    }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', repairMerged: true } } }),
  })
  assert.equal(result.issues[0].assembledGoal.fixMerged, true)
  assert.match(calls.find((c) => c.label === 'refresh:FIX-2').prompt, /REPAIR PR #77/)
})

check('an unmerged repair PR surfaces its own merge gate', async () => {
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          subPrs: [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a' }],
          assembledGoal: { passed: false, failure: 'f', fixIssue: 'FIX-50', fixPr: 77, fixMerged: false },
        }),
      ],
    }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', repairReadyToMerge: true } } }),
  })
  assert.deepEqual(result.gates, [{ kind: 'merge', issueId: 'FIX-2', pr: 77, repair: true }])
})

check('clearing a row blocker also clears the nested repair blocker', async () => {
  // `fixBlocker` is duplicated by design — it is issue-multi-pr's own durable field when that script
  // runs standalone. Under an epic the row-level blocker is the single point of human resolution, so
  // the nested copy is derived from it; otherwise it re-derives REPAIR_BLOCKED forever behind a field
  // the documented resolution path never touches.
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          blocker: null, // the coordinator recorded the human's answer
          subPrs: [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a' }],
          assembledGoal: { passed: false, failure: 'f', fixIssue: 'FIX-50', fixBlocker: 'which behaviour?' },
        }),
      ],
    }),
    respond: epicResponder({
      // A pending event, so "no longer parked" is a real assertion rather than a row that had
      // nothing to do anyway — and per-handle state, because a multi-PR scan that omits it is an
      // incomplete observation and deliberately consumes nothing.
      fresh: {
        'FIX-2': {
          phase: 'PR_FEEDBACK',
          newPrEvents: true,
          latestActivityAt: 'new',
          subPrStates: [{ id: 'a', merged: true, readyToMerge: false }],
        },
      },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK' } },
    }),
  })
  assert.equal(result.issues[0].assembledGoal.fixBlocker, null, 'the repair resumes')
  assert.deepEqual(workerLabels(calls), ['pr-feedback:FIX-2'], 'and the row is no longer parked')

  // While the row blocker STANDS, the nested copy must survive — it is the same decision.
  const held = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          blocker: 'which behaviour?',
          subPrs: [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a' }],
          assembledGoal: { passed: false, failure: 'f', fixIssue: 'FIX-50', fixBlocker: 'which behaviour?' },
        }),
      ],
    }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', newPrEvents: true, latestActivityAt: 'new' } } }),
  })
  assert.equal(held.result.issues[0].assembledGoal.fixBlocker, 'which behaviour?')
  assert.deepEqual(workerLabels(held.calls), [], 'and the row stays parked')
})

check('per-handle merge readiness never survives a wake as stale state', async () => {
  // It is an observation, not durable state: carried forward it keeps surfacing a merge gate for a
  // sub-PR the human already merged, or one a later push made unmergeable.
  const first = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'PR_FEEDBACK', subPrs: [{ id: 'a', status: 'open', pr: 41, branch: 'fix/a' }] })],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', subPrStates: [{ id: 'a', merged: false, readyToMerge: true }] } },
    }),
  })
  assert.equal(first.result.gates.length, 1)

  // Next wake, the scout dies: no live observation, so no gate.
  const second = await run('epic-wake.js', {
    args: epicArgs({ issues: [{ ...first.result.issues[0] }] }),
    respond: epicResponder({ nulls: ['refresh:FIX-2'] }),
  })
  assert.deepEqual(second.result.gates, [], 'a gate must rest on a live observation')
})

check('a multi-PR row is never DONE until its assembled goal passed', async () => {
  // Both a scout and a worker will reasonably call the last merge "done". It isn't: the merges do
  // not satisfy the end-to-end goal, so accepting either finishes the issue without ever proving it.
  for (const source of ['scout', 'worker']) {
    const { result } = await run('epic-wake.js', {
      args: epicArgs({
        issues: [
          row('FIX-2', {
            phase: 'PR_FEEDBACK',
            subPrs: [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a' }],
            assembledGoal: { passed: false },
          }),
        ],
      }),
      respond: epicResponder({
        fresh: { 'FIX-2': { phase: source === 'scout' ? 'DONE' : 'PR_FEEDBACK' } },
        worker: { 'FIX-2': { phase: source === 'worker' ? 'DONE' : 'PR_FEEDBACK' } },
      }),
    })
    assert.equal(result.issues[0].phase, 'PR_FEEDBACK', `${source}-reported DONE must not finish the issue`)
  }

  // And it IS done once the goal actually passed.
  const passed = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          subPrs: [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a' }],
          assembledGoal: { passed: true, evidence: 'ran it' },
        }),
      ],
    }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'PR_FEEDBACK' } } }),
  })
  assert.equal(passed.result.issues[0].phase, 'DONE')
})

check('a merge advances the DAG without waiting for PR activity', async () => {
  // A sub-PR merging is what unblocks the next slice, and it is not a comment or a review. Left to
  // `newPrEvents`, the DAG stalls at exactly the moment it became able to move.
  const { calls } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          subPrs: [
            { id: 'a', status: 'open', pr: 41, branch: 'fix/a' },
            { id: 'b', status: 'pending', pr: null, branch: null },
          ],
          assembledGoal: { passed: false },
        }),
      ],
    }),
    respond: epicResponder({
      // No new comments or reviews — only the merge.
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', subPrStates: [{ id: 'a', merged: true, readyToMerge: false }] } },
    }),
  })
  assert.deepEqual(workerLabels(calls), ['implement:FIX-2'], 'the merge is the event')
})

check('a quiet multi-PR row with nothing ready dispatches nothing', async () => {
  // The other side: every slice open and waiting on a human merge is a genuine external wait, not
  // work. Dispatching there would spend a worktree worker per wake to be told "nothing is ready".
  const { calls } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          subPrs: [{ id: 'a', status: 'open', pr: 41, branch: 'fix/a' }],
          assembledGoal: { passed: false },
          multiPrPending: false,
        }),
      ],
    }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', subPrStates: [{ id: 'a', merged: false, readyToMerge: false }] } } }),
  })
  assert.deepEqual(workerLabels(calls), [])
})

check('a worker reporting deferred DAG work is dispatched again next wake', async () => {
  // Cap-deferred slices need no external event, so nothing would ever wake them.
  const first = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'NEEDS_IMPLEMENTATION' })],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'NEEDS_IMPLEMENTATION', specApproved: true } },
      worker: {
        'FIX-2': {
          phase: 'PR_FEEDBACK',
          subPrs: [{ id: 'a', status: 'open', pr: 41, branch: 'fix/a' }],
          assembledGoal: { passed: false },
          multiPrPending: true,
        },
      },
    }),
  })
  assert.equal(first.result.issues[0].multiPrPending, true)

  const second = await run('epic-wake.js', {
    args: epicArgs({ issues: [{ ...first.result.issues[0] }] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', subPrStates: [{ id: 'a', merged: false, readyToMerge: false }] } },
      // Echoing the value it was handed, which is what the prompt tells a worker that ran no DAG step
      // (or one whose DAG still has deferred slices) to do.
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', multiPrPending: true } },
    }),
  })
  assert.deepEqual(workerLabels(second.calls), ['implement:FIX-2'])
  assert.equal(second.result.issues[0].multiPrPending, true, 'a worker that echoes the carried value keeps it')

  // And the run that finds nothing left to do clears it. This is the half that used to be UNREACHABLE:
  // the field was optional and the prompt asked only for the true case, so nothing ever reported the
  // false. Once set it stayed set, `multiPrHasWork` made the row actionable on every wake, and with a
  // cap of 2 and a stable row order that starves every other issue in the epic indefinitely.
  const third = await run('epic-wake.js', {
    args: epicArgs({ issues: [{ ...second.result.issues[0] }] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', subPrStates: [{ id: 'a', merged: false, readyToMerge: false }] } },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', multiPrPending: false } },
    }),
  })
  assert.equal(third.result.issues[0].multiPrPending, false)

  // ...and having drained, it stops being dispatched, which is the point of clearing it.
  const fourth = await run('epic-wake.js', {
    args: epicArgs({ issues: [{ ...third.result.issues[0] }] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', subPrStates: [{ id: 'a', merged: false, readyToMerge: false }] } },
    }),
  })
  assert.deepEqual(workerLabels(fourth.calls), [], 'a drained DAG waits for an event like any other row')
})

check('a worker that runs no DAG step is given the value to echo, not left to guess it', async () => {
  // `multiPrPending` is required, so silence is not an option — which fixes the field having no
  // clearing path, and creates the opposite risk: a verdict fold knows nothing about the DAG, and if it
  // guesses `false` it strands cap-deferred slices for good, because no external event will wake them.
  //
  // The prompt is what closes that, so the prompt is what this asserts. Nothing else can: once the
  // field is required, the fold rule has no omission left to be lenient about.
  const { calls } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          subPrs: [{ id: 'a', status: 'open', pr: 41, branch: 'fix/a' }],
          assembledGoal: { passed: false },
          multiPrPending: true,
          verdicts: [{ claim: 'c', verdict: 'REFUTED', evidence: 'e' }],
        }),
      ],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', subPrStates: [{ id: 'a', merged: false, readyToMerge: false }] } },
    }),
  })
  assert.deepEqual(workerLabels(calls), ['apply-verdict:FIX-2'], 'the verdict outranks the DAG this wake')
  const prompt = calls.find((c) => c.label === 'apply-verdict:FIX-2').prompt
  assert.match(prompt, /multiPrPending \(carried\): true/, 'the carried value is in the prompt to echo')
  assert.match(prompt, /echo the carried value/, 'and the worker is told to echo it rather than answer false')
})

check('the worker is handed the assemble state, not just the sub-PR table', async () => {
  // It runs in an isolated worktree with no access to `.orchestration/`, so state it isn't given
  // does not exist for it: it would re-run the goal and file a second repair for a tracked gap.
  // The repair has MERGED, so the goal is re-armed and there is real work. (An unmerged `fixPr` is a
  // wait on the human, and correctly dispatches nothing — which is what the sibling check covers.)
  const assembledGoal = { passed: false, failure: 'stream closed early', fixIssue: 'FIX-50', fixPr: 77, fixMerged: true }
  const { calls } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          subPrs: [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a' }],
          assembledGoal,
          multiPrPending: true,
        }),
      ],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK' } },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK' } },
    }),
  })
  const prompt = calls.find((c) => c.label === 'implement:FIX-2').prompt
  assert.match(prompt, /assembledGoal: /)
  assert.match(prompt, /FIX-50/)
  assert.match(prompt, /"fixPr":77/)
})

check('a sub-PR state naming a handle nobody asked about lands nowhere', async () => {
  // The fourth instance of this class. A misattributed `merged: true` marks the wrong node merged,
  // and a dependent then builds off origin/main before its real prerequisite has landed.
  //
  // What "misattributed" MEANS is the part that moved. It used to mean "an id that disagrees with its
  // position", which made a scan reporting the right handles in a different order misattributed too —
  // so it was thrown away wholesale while the cursor advanced, losing exactly the merge it reported.
  // The rule that survives is the one that was doing the work all along: a response may only ever
  // land on a handle that was DISPATCHED. Order is not identity, and never was.
  const { result, logs } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          subPrs: [
            { id: 'a', status: 'open', pr: 41, branch: 'fix/a' },
            { id: 'b', status: 'open', pr: 42, branch: 'fix/b' },
          ],
          assembledGoal: { passed: false },
        }),
      ],
    }),
    respond: epicResponder({
      fresh: {
        'FIX-2': {
          phase: 'PR_FEEDBACK',
          // An id outside the dispatched set, alongside a real one. The whole scan is refused rather
          // than the good half kept: a scout inventing handles is not a scout to believe about `a`
          // either, and `cursorUsable` then holds the activity so a later scan re-derives it.
          subPrStates: [
            { id: 'a', merged: true, readyToMerge: false },
            { id: 'zz', merged: true, readyToMerge: false },
          ],
        },
      },
    }),
  })
  const subPrs = result.issues[0].subPrs
  assert.equal(subPrs.length, 2, 'a handle nobody dispatched is never added to the table')
  assert.equal(subPrs.find((s) => s.id === 'a').status, 'open', 'and the scan that named it is not half-applied')
  assert.equal(subPrs.find((s) => s.id === 'b').status, 'open')
  assert.match(logs.join('\n'), /ids don't match the handles they were asked about/)

  // The reorder that used to be discarded with it. Same two handles, answered in the other order:
  // now folded, because the ids are all dispatched ones and position never carried meaning.
  const reordered = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          subPrs: [
            { id: 'a', status: 'open', pr: 41, branch: 'fix/a' },
            { id: 'b', status: 'open', pr: 42, branch: 'fix/b' },
          ],
          assembledGoal: { passed: false },
          newPrEvents: true,
          latestActivityAt: 'new',
        }),
      ],
    }),
    respond: epicResponder({
      fresh: {
        'FIX-2': {
          phase: 'PR_FEEDBACK',
          newPrEvents: true,
          latestActivityAt: 'new',
          subPrStates: [
            { id: 'b', merged: false, readyToMerge: false },
            { id: 'a', merged: true, readyToMerge: false },
          ],
        },
      },
    }),
  })
  const re = reordered.result.issues[0].subPrs
  assert.equal(re.find((s) => s.id === 'a').status, 'merged', 'the reported merge is persisted, not discarded as a mismatch')
  assert.equal(re.find((s) => s.id === 'b').status, 'open')
  assert.equal(
    reordered.result.issues[0].lastSeenActivityAt,
    'new',
    'and the cursor may advance, because the scan answered every handle',
  )
})

check('an in-session approval is refused once a newer head has been observed', async () => {
  // The two-wake case: a previous wake persisted a push past the approved SHA. If this wake's scout
  // dies, "no fresh head" must not read as "nothing contradicts it" — the coordinator already knows.
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'AWAITING_SPEC_APPROVAL',
          specPr: 7,
          approvedInSession: 'head1',
          headSha: 'head2', // observed and persisted by an earlier wake
        }),
      ],
    }),
    respond: epicResponder({ nulls: ['refresh:FIX-2'] }),
  })
  assert.deepEqual(workerLabels(calls), [], 'a known-newer head invalidates the approval')
  assert.equal(result.issues[0].specApproved, false)
})

check('a headless live epic scan holds work even when the epic was already approved', async () => {
  // The distinguishing case: with a DURABLE approval carried, falling back to it on a partial scan
  // releases child workers against an objective SHA the scan just failed to confirm. The sibling
  // check above carries no prior approval, so it cannot tell the two rules apart — it passed under
  // both until this one was added.
  const { result, calls, logs } = await run('epic-wake.js', {
    args: epicArgs({
      epic: { issueId: 'FIX-1', branch: 'epic/t', prNumber: 100, approved: true, headSha: 'preapproval' },
      issues: [row('FIX-2')],
    }),
    respond: (prompt, opts) => {
      const label = opts.label || ''
      if (label === 'gate:epic') return { approved: true, approvedByLabel: false, headSha: null, newReviewEvents: false, latestActivityAt: null }
      if (label === 'linear:epic-children') return { issues: [] }
      if (label.startsWith('refresh:')) return { issueId: 'FIX-2', ...freshRow() }
      return { issueId: 'FIX-2', ...workerRes() }
    },
  })
  assert.equal(result.epicApproved, false, 'a live scan with no head releases nothing, approved or not')
  assert.deepEqual(workerLabels(calls), [], 'so no child worker is dispatched')
  assert.equal(result.epic.approved, true, 'but the durable approval is not revoked by an unusable scan either')
  assert.match(logs.join('\n'), /no current head/)
})

check('a freshly reported nested blocker is lifted to the row, not erased', async () => {
  // `subPrs[].blocker` is the nested workflow's native field, so a worker can return one without
  // also setting the row-level mirror. The resolution rule reads an absent row-level blocker as
  // "the human answered", so without lifting it the next refresh erases an escalation nobody saw.
  const first = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          subPrs: [{ id: 'a', status: 'open', pr: 41, branch: 'fix/a' }],
          assembledGoal: { passed: false },
          multiPrPending: true,
        }),
      ],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK' } },
      // Nested blocker only — no row-level mirror.
      worker: {
        'FIX-2': { phase: 'PR_FEEDBACK', subPrs: [{ id: 'a', status: 'open', pr: 41, branch: 'fix/a', blocker: 'which shape?' }] },
      },
    }),
  })
  assert.match(first.result.issues[0].blocker, /a: which shape\?/, 'the escalation is surfaced at row level')
  assert.ok(first.result.blockers.some((b) => /which shape/.test(b.blocker)), 'and reaches the human')

  // Next wake it survives, and the row is parked rather than re-dispatched.
  const second = await run('epic-wake.js', {
    args: epicArgs({ issues: [{ ...first.result.issues[0] }] }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'PR_FEEDBACK' } } }),
  })
  assert.equal(second.result.issues[0].subPrs[0].blocker, 'which shape?', 'the nested copy is not erased')
  assert.deepEqual(workerLabels(second.calls), [])
})

check('a malformed PR plan comes back as a blocker rather than silence', async () => {
  // issue-multi-pr dispatches nothing for a duplicate id, cycle or unknown dependency, and only a
  // human can fix it — returned as neither work nor blocker nor gate, the row sits forever.
  const { calls } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          subPrs: [{ id: 'a', status: 'pending', pr: null, branch: null }],
          assembledGoal: { passed: false },
          multiPrPending: true,
        }),
      ],
    }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'PR_FEEDBACK' } }, worker: { 'FIX-2': { phase: 'PR_FEEDBACK' } } }),
  })
  const prompt = calls.find((c) => c.label === 'implement:FIX-2').prompt
  assert.match(prompt, /reports any sub-PR as invalid/)
  assert.match(prompt, /return that as your `blocker`/)
})

check('clearing a row blocker also clears a nested sub-PR blocker', async () => {
  // The third copy of the same human decision (row, assembledGoal, sub-PR). `classify()` refuses to
  // dispatch a slice while its own blocker is set, and the documented resolution path clears only
  // the row-level one — so a nested copy parks that slice permanently after the user has answered.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          blocker: null, // the coordinator recorded the human's answer
          blockerFor: 'a', // …to this slice's decision
          subPrs: [
            { id: 'a', status: 'open', pr: 41, branch: 'fix/a', blocker: 'which shape?' },
            { id: 'b', status: 'pending', pr: null, branch: null, blocker: null },
          ],
          assembledGoal: { passed: false },
          multiPrPending: true,
        }),
      ],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK' } },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK' } },
    }),
  })
  assert.equal(result.issues[0].subPrs.find((s) => s.id === 'a').blocker, null, 'the slice resumes')

  // While the row blocker stands, the nested copy survives — it is the same unanswered decision.
  const held = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          blocker: 'which shape?',
          subPrs: [{ id: 'a', status: 'open', pr: 41, branch: 'fix/a', blocker: 'which shape?' }],
          assembledGoal: { passed: false },
        }),
      ],
    }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'PR_FEEDBACK' } } }),
  })
  assert.equal(held.result.issues[0].subPrs[0].blocker, 'which shape?')
})

check('a repair PR awaiting its human merge dispatches nothing and keeps its gate', async () => {
  // Both halves of the same mistake: treating AWAITING_FIX as "work" spends a worktree worker every
  // wake to be told to wait, AND voids the merge readiness the repair PR's own gate depends on — so
  // the human is never asked to merge the thing the DAG is waiting for.
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          subPrs: [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a' }],
          assembledGoal: { passed: false, failure: 'f', fixIssue: 'FIX-50', fixPr: 77, fixMerged: false },
        }),
      ],
    }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', repairReadyToMerge: true } } }),
  })
  assert.deepEqual(workerLabels(calls), [], 'waiting on a human merge is a wait, not work')
  assert.deepEqual(result.gates, [{ kind: 'merge', issueId: 'FIX-2', pr: 77, repair: true }])
})

check('NEEDS_IMPLEMENTATION cannot dispatch without an established approval', async () => {
  // The phase NAME asserts approval; only `specApproved` establishes it, and the schema validates the
  // two independently — so a mis-derived phase would implement a spec no human approved.
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7 })] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'NEEDS_IMPLEMENTATION', specApproved: false, specPr: 7 } },
    }),
  })
  assert.deepEqual(workerLabels(calls), [], 'the one mandatory gate is not carried by a phase name')
  assert.ok(result.gates.some((g) => g.kind === 'spec-approval' && g.issueId === 'FIX-2'))

  // With the approval established it proceeds.
  const approved = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7 })] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'NEEDS_IMPLEMENTATION', specApproved: true, specPr: 7 } },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9, specPr: 7 } },
    }),
  })
  assert.deepEqual(workerLabels(approved.calls), ['implement:FIX-2'])
})

check('a parked row is never offered for merge', async () => {
  // `pendingAction` parks on an unresolved decision or an open prerequisite; the merge gate was
  // independent of it, so the human was told to merge work whose blocker they had not answered.
  for (const park of [{ blocker: 'which behaviour?' }, { blockedBy: ['FIX-9'] }]) {
    const { result } = await run('epic-wake.js', {
      args: epicArgs({ issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9, ...park })] }),
      respond: (prompt, opts) => {
        const label = opts.label || ''
        if (label === 'gate:epic') return { approved: true, approvedByLabel: false, headSha: 'abc', newReviewEvents: false, latestActivityAt: null }
        if (label === 'linear:epic-children') return { issues: [] }
        if (label.startsWith('refresh:')) return { issueId: 'FIX-2', ...freshRow({ phase: 'PR_FEEDBACK', readyToMerge: true, implPr: 9 }) }
        return workerRes({ issueId: 'FIX-2' })
      },
    })
    assert.deepEqual(
      result.gates.filter((g) => g.kind === 'merge'),
      [],
      `a row parked by ${Object.keys(park)[0]} must not be merge-gated`,
    )
  }
})

check("an answered sibling's decision is not lost when the next blocker is lifted", async () => {
  // The sibling QUEUE guarantees this: answering A clears A's nested blocker and lifts B in the same
  // pass, which parks the row — so A's answer is never dispatched. A single-slot resolution field is
  // then overwritten when the human answers B, and A's slice resumes with nothing and re-escalates the
  // identical fork. Same reasoning `verdicts` already carries; the lesson was in the file when the
  // field was added as a single slot.
  const answeredA = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          blocker: null, // A answered
          blockerFor: 'a',
          blockerResolutions: [{ for: null, answer: 'A: use the store adapter' }],
          subPrs: [
            { id: 'a', status: 'pending', blocker: 'which shape?' },
            { id: 'b', status: 'pending', blocker: 'which owner?' },
          ],
          assembledGoal: { passed: false },
          multiPrPending: true,
        }),
      ],
    }),
    respond: epicResponder({
      fresh: {
        'FIX-2': {
          phase: 'PR_FEEDBACK',
          subPrStates: [
            { id: 'a', merged: false, readyToMerge: false },
            { id: 'b', merged: false, readyToMerge: false },
          ],
        },
      },
    }),
  })
  const rowA = answeredA.result.issues[0]
  assert.equal(rowA.blocker, 'b: which owner?', "B is lifted, so the row parks and A's dispatch waits")
  assert.deepEqual(workerLabels(answeredA.calls), [], 'parked')
  assert.deepEqual(
    rowA.blockerResolutions,
    [{ for: 'a', answer: 'A: use the store adapter' }],
    "A's answer survives the park, aimed at A by the marker that was current when it was given",
  )

  // The human now answers B. Both answers have to be there — this is where the single slot dropped A.
  const answeredB = await run('epic-wake.js', {
    args: epicArgs({
      issues: [{ ...rowA, blocker: null, blockerResolutions: [...rowA.blockerResolutions, { for: 'b', answer: 'B: Bob owns it' }] }],
    }),
    respond: epicResponder({
      // This is the wake that DISPATCHES, so its worker has to report the DAG state it ran: for a
      // multi-PR row that return is the receipt, and without it the answers are correctly retained.
      worker: {
        'FIX-2': {
          phase: 'PR_FEEDBACK',
          multiPrPending: true,
          subPrs: [
            { id: 'a', status: 'open', pr: 41, branch: 'fix/a' },
            { id: 'b', status: 'open', pr: 42, branch: 'fix/b' },
          ],
        },
      },
      fresh: {
        'FIX-2': {
          phase: 'PR_FEEDBACK',
          subPrStates: [
            { id: 'a', merged: false, readyToMerge: false },
            { id: 'b', merged: false, readyToMerge: false },
          ],
        },
      },
    }),
  })
  const prompt = answeredB.calls.find((c) => c.label === 'implement:FIX-2').prompt
  assert.match(prompt, /\[a\] A: use the store adapter/, "A's decision reaches the dispatch it was waiting for")
  assert.match(prompt, /\[b\] B: Bob owns it/)
  assert.deepEqual(answeredB.result.issues[0].blockerResolutions, [], 'and both are consumed together')
})

check('a row parked on an unanswered decision is not offered for spec approval', async () => {
  // Merge gates learned this ("parking has to mean parked everywhere") and the spec-approval gate did
  // not — its comment even noted the filter was independent of parking without drawing the conclusion.
  // A spec-review worker that escalates an architectural fork parks the row; inviting approval anyway
  // asks the human to sign off an artifact whose open question is unanswered, and approval is what
  // releases implementation.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8, blocker: 'one store or two?' })],
    }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 } } }),
  })
  assert.deepEqual(
    result.gates.filter((g) => g.kind === 'spec-approval'),
    [],
    'no approval is invited while the decision that stopped the review is open',
  )
  assert.ok(
    result.blockers.some((b) => b.blocker === 'one store or two?'),
    'the question itself is still surfaced — withholding the gate must not hide the ask',
  )

  // Answered: the gate appears, which is what makes withholding a sequencing rule and not a dead end.
  const answered = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 })] }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 } } }),
  })
  assert.deepEqual(answered.result.gates.filter((g) => g.kind === 'spec-approval').map((g) => g.pr), [8])
})

check('a standalone multi-PR caller can unblock a slice with an answer alone', async () => {
  // Under an epic, `epic-wake`'s refresh clears the nested blocker before dispatch, so the forwarding
  // worked. Called directly from `issue-lifecycle` there is no equivalent step — `classify()` returns
  // null for a node with `blocker` set and `assembleState()` returns REPAIR_BLOCKED on `fixBlocker`, so
  // a supplied answer could never reach a worker and the slice stayed blocked forever. The ANSWER is
  // what clears the blocker it answers, in the script, so both callers get the same behaviour.
  const { calls } = await run('issue-multi-pr.js', {
    args: {
      issueId: 'FIX-2',
      subPrs: [{ id: 'a', status: 'pending', dependsOn: [], blocker: 'which shape?' }],
      blockerResolutions: [{ for: 'a', answer: 'use the store adapter' }],
    },
    respond: multiResponder({}),
  })
  assert.deepEqual(
    calls.filter((c) => (c.label || '').startsWith('build:')).map((c) => c.label),
    ['build:a'],
    'the answered slice is dispatched rather than parked',
  )
  assert.match(calls.find((c) => c.label === 'build:a').prompt, /ANSWERED by the human/)

  // Without the answer it stays parked — otherwise the check above proves nothing.
  const stillBlocked = await run('issue-multi-pr.js', {
    args: { issueId: 'FIX-2', subPrs: [{ id: 'a', status: 'pending', dependsOn: [], blocker: 'which shape?' }] },
    respond: multiResponder({}),
  })
  assert.deepEqual(stillBlocked.calls.filter((c) => (c.label || '').startsWith('build:')), [])

  // The REPAIR blocker is the third copy of the same decision and needs the same treatment: without it
  // `assembleState` returns REPAIR_BLOCKED forever, so an answered repair never runs standalone.
  const repairArgs = (over = {}) => ({
    issueId: 'FIX-2',
    subPrs: [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a', dependsOn: [] }],
    assembledGoal: {
      passed: false,
      failure: 'the two slices disagree on the cache key',
      evidence: 'ran it',
      fixIssue: 'FIX-9',
      owningSubPr: 'a',
      fixBlocker: 'which shape?',
    },
    ...over,
  })
  const repairBlocked = await run('issue-multi-pr.js', { args: repairArgs(), respond: multiResponder({}) })
  assert.deepEqual(
    repairBlocked.calls.filter((c) => (c.label || '').startsWith('assembled-fix')),
    [],
    'REPAIR_BLOCKED dispatches nothing, as it should',
  )

  const repairAnswered = await run('issue-multi-pr.js', {
    args: repairArgs({ blockerResolutions: [{ for: 'a', answer: 'key on tenant + scope' }] }),
    respond: multiResponder({}),
  })
  assert.deepEqual(
    repairAnswered.calls.filter((c) => (c.label || '').startsWith('assembled-fix')).map((c) => c.label),
    ['assembled-fix:FIX-2'],
    'the answered repair proceeds',
  )
  assert.match(repairAnswered.calls.find((c) => c.label === 'assembled-fix:FIX-2').prompt, /key on tenant \+ scope/)
  assert.match(repairAnswered.logs.join('\n'), /Repair blocker for FIX-2 was answered/)
})

check('INVARIANT: every gate withholds on an unanswered human decision', async () => {
  // Two gate kinds diverged once already: the merge gate got the rule and the spec-approval gate kept
  // its own filter. Naming the call sites is what let that happen, so this asserts the SHAPE — every
  // gate a parked row could produce must be absent — for any row state that parks.
  for (const park of [{ blocker: 'which behaviour?' }, { blocker: 'POC returned INCONCLUSIVE — needs a human decision: x' }]) {
    const { result } = await run('epic-wake.js', {
      args: epicArgs({
        issues: [
          row('FIX-2', {
            phase: 'AWAITING_SPEC_APPROVAL',
            specPr: 8,
            implPr: 9,
            subPrs: [{ id: 'a', status: 'open', pr: 41, branch: 'fix/a' }],
            assembledGoal: { passed: false, fixPr: 77, fixMerged: false },
            ...park,
          }),
        ],
      }),
      respond: epicResponder({
        fresh: {
          'FIX-2': {
            phase: 'AWAITING_SPEC_APPROVAL',
            specPr: 8,
            implPr: 9,
            readyToMerge: true,
            repairMerged: false,
            repairReadyToMerge: true,
            subPrStates: [{ id: 'a', merged: false, readyToMerge: true }],
          },
        },
      }),
    })
    // Every gate kind this row could otherwise emit: spec-approval, its own merge, a sub-PR merge, the
    // repair merge. A parked row emits none of them.
    assert.deepEqual(
      result.gates.filter((g) => g.issueId === 'FIX-2'),
      [],
      `a row parked by ${JSON.stringify(park)} must emit no gate of any kind`,
    )
  }
})

check('an unanswered sibling blocker survives its neighbour being resolved', async () => {
  // Two sub-PR workers can escalate different decisions in one wake; the row surfaces the first.
  // Clearing all of them on that one answer lets the sibling's slice resume on a decision nobody made.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          blocker: null, // the human answered the one the row named
          blockerFor: 'a',
          subPrs: [
            { id: 'a', status: 'open', pr: 41, branch: 'fix/a', blocker: 'which shape?' },
            { id: 'b', status: 'open', pr: 42, branch: 'fix/b', blocker: 'which owner?' },
          ],
          assembledGoal: { passed: false },
          multiPrPending: true,
        }),
      ],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK' } },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK' } },
    }),
  })
  const subPrs = result.issues[0].subPrs
  assert.equal(subPrs.find((s) => s.id === 'a').blocker, null, 'the answered slice resumes')
  assert.equal(subPrs.find((s) => s.id === 'b').blocker, 'which owner?', 'the unanswered one does not')
  assert.match(result.issues[0].blocker, /b: which owner\?/, 'and it is surfaced next — a queue, not a loss')
})

check("a multi-PR row's PR feedback is handled before the DAG step", async () => {
  // issue-multi-pr only builds, rebases and assembles — it has no notion of an open PR's review
  // comments, so pointed straight at the DAG the row reports "waiting" and the batch is consumed.
  const { calls } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          subPrs: [{ id: 'a', status: 'open', pr: 41, branch: 'fix/a' }],
          assembledGoal: { passed: false, fixPr: 77, fixMerged: false },
          lastSeenActivityAt: 'old',
        }),
      ],
    }),
    respond: epicResponder({
      fresh: {
        'FIX-2': {
          phase: 'PR_FEEDBACK',
          newPrEvents: true,
          latestActivityAt: 'new',
          subPrStates: [{ id: 'a', merged: false, readyToMerge: false }],
          // The row has an open repair PR, so a scan that wants to consume its activity has to say
          // whether that repair merged. `false` is an answer; omitting it is an incomplete scan.
          repairMerged: false,
        },
      },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK' } },
    }),
  })
  const prompt = calls.find((c) => c.label === 'pr-feedback:FIX-2').prompt
  assert.match(prompt, /Handle it the way issue-implement handles PR feedback/)
  assert.match(prompt, /BEFORE any DAG step/)
  assert.match(prompt, /a=#41/)
  assert.match(prompt, /repair=#77/)
})

check('DONE without merge evidence is refused on a single-PR row too', async () => {
  // A worker that has just opened the impl PR will reasonably feel done. Accepting it means the
  // coordinator mirrors Done in Linear and can wrap the epic before the human merges anything.
  for (const source of ['scout', 'worker']) {
    const { result } = await run('epic-wake.js', {
      args: epicArgs({ issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9 })] }),
      respond: epicResponder({
        fresh: { 'FIX-2': { phase: source === 'scout' ? 'DONE' : 'PR_FEEDBACK', implPr: 9, newPrEvents: true } },
        worker: { 'FIX-2': { phase: source === 'worker' ? 'DONE' : 'PR_FEEDBACK', implPr: 9 } },
      }),
    })
    assert.equal(result.issues[0].phase, 'PR_FEEDBACK', `${source}-reported DONE without a merge must not finish the row`)
  }

  // With the merge observed it is genuinely done.
  const merged = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9 })] }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'DONE', implPr: 9, merged: true } } }),
  })
  assert.equal(merged.result.issues[0].phase, 'DONE')
})

check('an observed merge finishes a single-PR row even when the scan still calls it PR_FEEDBACK', async () => {
  // The INVERSE of the rule above, and it was missing — a rule applied in one direction only. This is
  // the honest report of a scout looking at a row whose PR landed between wakes: the phase it carried
  // is PR_FEEDBACK and the merge is new. Nothing then matched: no events, no CI failure, no DAG, so
  // `pendingAction` returned no work; and `readyToMerge` is false on an already-merged PR, so no gate
  // was surfaced either. The row idled permanently with nothing to explain it, and the epic could
  // never satisfy its wrap condition.
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9 })] }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9, merged: true } } }),
  })
  assert.equal(result.issues[0].phase, 'DONE', 'the merge decides, in both directions')
  assert.deepEqual(workerLabels(calls), [], 'and a finished row is not dispatched')
  assert.deepEqual(
    result.gates.filter((g) => g.kind === 'merge'),
    [],
    'nor asked to be merged again',
  )
})

check('a scan that omits repairMerged is incomplete, and consumes nothing', async () => {
  // `repairMerged` is the ONLY observation that can set `fixMerged`, and while that stays false the
  // assemble machine waits in AWAITING_FIX. So a scan that reports activity but omits the field after
  // the repair landed loses the merge, and the row then waits for a merge event that already happened.
  const held = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          subPrs: [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a' }],
          assembledGoal: { passed: false, fixPr: 77, fixMerged: false },
          lastSeenActivityAt: 'old',
        }),
      ],
    }),
    respond: epicResponder({
      fresh: {
        'FIX-2': {
          phase: 'PR_FEEDBACK',
          newPrEvents: true,
          latestActivityAt: 'new',
          subPrStates: [{ id: 'a', merged: true, readyToMerge: false }],
          // repairMerged omitted — schema-valid, and an answer to nothing.
        },
      },
    }),
  })
  assert.deepEqual(workerLabels(held.calls), [], 'an incomplete scan dispatches no feedback worker')
  assert.equal(held.result.issues[0].lastSeenActivityAt, 'old', 'and the activity stays live for a scan that looks')
  assert.match(held.logs.join('\n'), /treating the scan as incomplete/)

  // `false` is an answer: the scan looked, the repair is still open, and the row waits on its merge
  // gate rather than on a better scan.
  const answered = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          subPrs: [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a' }],
          assembledGoal: { passed: false, fixPr: 77, fixMerged: false },
          lastSeenActivityAt: 'old',
        }),
      ],
    }),
    respond: epicResponder({
      fresh: {
        'FIX-2': {
          phase: 'PR_FEEDBACK',
          newPrEvents: true,
          latestActivityAt: 'new',
          subPrStates: [{ id: 'a', merged: true, readyToMerge: false }],
          repairMerged: false,
          repairReadyToMerge: true,
        },
      },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', multiPrPending: false } },
    }),
  })
  assert.deepEqual(workerLabels(answered.calls), ['pr-feedback:FIX-2'])
  assert.equal(answered.result.issues[0].lastSeenActivityAt, 'new')
})

check('an epic approval that could not be confirmed does not release work on the next dead scout', async () => {
  // A live scan with no head correctly holds the CURRENT wake. The hold has to survive into the next
  // one: leaving `approved: true` persisted beside the old head let the following wake take the
  // dead-scout branch, read the durable approval as good, and release every child worker against an
  // objective the last real observation could not confirm was current.
  const headless = await run('epic-wake.js', {
    args: epicArgs({
      epic: { issueId: 'FIX-1', name: 'thing', branch: 'epic/thing', prNumber: 100, approved: true, headSha: 'old' },
      issues: [row('FIX-2', { phase: 'NEEDS_SPEC' })],
    }),
    respond: epicResponder({ gateHeadSha: null, fresh: { 'FIX-2': { phase: 'NEEDS_SPEC' } } }),
  })
  assert.equal(headless.result.epicApproved, false, 'this wake holds')
  assert.equal(headless.result.epic.headUnconfirmed, true, 'and records why, so the next wake can too')

  const deadScout = await run('epic-wake.js', {
    args: epicArgs({ epic: { ...headless.result.epic }, issues: [{ ...headless.result.issues[0] }] }),
    respond: epicResponder({ nulls: ['gate:epic'], fresh: { 'FIX-2': { phase: 'NEEDS_SPEC' } } }),
  })
  assert.equal(deadScout.result.epicApproved, false, 'an unconfirmed approval is not a durable one')
  assert.deepEqual(workerLabels(deadScout.calls), [], 'so no child work is released against the old objective')

  // Clearing path: any scan that returns a head. Without one the epic would be locked out for good.
  const confirmed = await run('epic-wake.js', {
    args: epicArgs({ epic: { ...deadScout.result.epic }, issues: [{ ...deadScout.result.issues[0] }] }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'NEEDS_SPEC' } } }),
  })
  assert.equal(confirmed.result.epic.headUnconfirmed, false)
  assert.deepEqual(workerLabels(confirmed.calls), ['spec:FIX-2'], 'and the epic resumes')
})

check("a resolved blocker's answer reaches the next worker, exactly once", async () => {
  // The coordinator clears `blocker` when the human answers — but the next worker is a fresh sub-agent
  // in a fresh worktree that never saw the escalation and cannot read the session. Clearing alone
  // released it to walk back to the identical fork, where its only options were to escalate the same
  // question again or invent the answer the gate existed to supply.
  const first = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'NEEDS_IMPLEMENTATION',
          specApproved: true,
          blocker: null, // answered
          blockerResolutions: [{ for: null, answer: 'use the store adapter, not a bespoke cache' }],
        }),
      ],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'NEEDS_IMPLEMENTATION', specApproved: true } },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9 } },
    }),
  })
  const prompt = first.calls.find((c) => c.label === 'implement:FIX-2').prompt
  assert.match(prompt, /use the store adapter, not a bespoke cache/, 'the decision travels with the dispatch')
  assert.match(prompt, /do not escalate the same forks again/)
  assert.deepEqual(first.result.issues[0].blockerResolutions, [], 'and is consumed, so a later worker is not told it is fresh')

  // A dispatch that DIED consumed nothing, so the answer survives for the retry — the same rule the
  // cursor gets. Otherwise an infrastructure failure silently discards the human's decision.
  const died = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'NEEDS_IMPLEMENTATION',
          specApproved: true,
          blockerResolutions: [{ for: null, answer: 'use the store adapter, not a bespoke cache' }],
        }),
      ],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'NEEDS_IMPLEMENTATION', specApproved: true } },
      nulls: ['implement:FIX-2'],
    }),
  })
  assert.deepEqual(
    died.result.issues[0].blockerResolutions,
    [{ for: null, answer: 'use the store adapter, not a bespoke cache' }],
    'a dead worker consumes nothing',
  )
})

check("a multi-PR row's blocker answer is forwarded to the nested DAG workers", async () => {
  // One hop short is the same defect as no channel at all. The escalation came from a build or fix
  // worker inside `issue-multi-pr`, and those are freshly spawned each wake — so a resolution that
  // reaches only the outer issue-worker leaves the agent that actually hits the fork with nothing, able
  // only to escalate the identical question again or guess the answer the gate existed to supply.
  const { calls } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          subPrs: [
            { id: 'a', status: 'pending' },
            { id: 'b', status: 'open', pr: 42, branch: 'fix/b' },
          ],
          assembledGoal: { passed: false },
          multiPrPending: true,
          blocker: null, // answered
          blockerFor: 'a',
          blockerResolutions: [{ for: 'a', answer: 'use the store adapter, not a bespoke cache' }],
        }),
      ],
    }),
    respond: epicResponder({
      fresh: {
        'FIX-2': {
          phase: 'PR_FEEDBACK',
          subPrStates: [
            { id: 'a', merged: false, readyToMerge: false },
            { id: 'b', merged: false, readyToMerge: false },
          ],
        },
      },
    }),
  })
  const prompt = calls.find((c) => c.label === 'implement:FIX-2').prompt
  assert.match(prompt, /Pass those through to issue-multi-pr/, 'the worker is told to forward it, not just told the answer')
  assert.match(prompt, /blockerResolutions: \[\{"for":"a","answer":"use the store adapter, not a bespoke cache"\}\]/, 'in the args block, aimed at the slice that escalated')
})

check('a nested DAG worker is given the answer, aimed at the slice that asked', async () => {
  // The receiving half, in issue-multi-pr: the build worker for the slice that escalated gets the
  // decision, and its sibling does not — a broadcast answer invites a worker to apply a decision made
  // about someone else's fork.
  const { calls } = await run('issue-multi-pr.js', {
    args: {
      issueId: 'FIX-2',
      subPrs: [
        { id: 'a', status: 'pending', dependsOn: [] },
        { id: 'b', status: 'pending', dependsOn: [] },
      ],
      blockerResolutions: [{ for: 'a', answer: 'use the store adapter, not a bespoke cache' }],
    },
    respond: multiResponder({}),
  })
  const forA = calls.find((c) => c.label === 'build:a').prompt
  const forB = calls.find((c) => c.label === 'build:b').prompt
  assert.match(forA, /has been ANSWERED by the human:\n {2}- use the store adapter/)
  assert.match(forA, /do not escalate the same fork again/)
  assert.equal(calls.filter((c) => c.label === 'build:a').length, 1)
  assert.doesNotMatch(forB, /ANSWERED by the human/, "a sibling slice is not handed another slice's decision")
})

check("an answered epic question is folded into the epic-spec before it is cleared", async () => {
  // The question was persisted and re-surfaced every wake; the ANSWER had nowhere to live. No field
  // held it, no prompt carried it to `epic-agent`, and nothing triggered a fold — so unless unrelated
  // review activity happened to arrive, the epic-spec was never updated and every child issue kept
  // working against the unresolved version. The coordinator dropping the question on the user's answer
  // completed the loss: decision made, nothing recorded, no trace it was ever asked.
  const { result, calls, logs } = await run('epic-wake.js', {
    args: epicArgs({
      epic: {
        issueId: 'FIX-1',
        name: 'thing',
        branch: 'epic/thing',
        prNumber: 100,
        openQuestions: ['one store or two?'],
        unsettled: [{ claim: 'does SSE resume across redeploys?', evidence: 'inconclusive', threads: 't' }],
        answers: [
          { question: 'one store or two?', answer: 'one, scoped per tenant' },
          { question: 'does SSE resume across redeploys?', answer: 'assume it does not; buffer client-side' },
        ],
      },
      issues: [row('FIX-2', { phase: 'NEEDS_SPEC' })],
    }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'NEEDS_SPEC' } } }),
  })
  assert.deepEqual(labels(calls, 'fold:epic'), ['fold:epic'], 'an answer triggers a fold on its own')
  const prompt = calls.find((c) => c.label === 'fold:epic').prompt
  assert.match(prompt, /A: one, scoped per tenant/, 'and the fold is given the decision to record')
  assert.match(prompt, /outside the review budget/, 'an answer to a question we asked is not another opinion')
  assert.equal(result.epic.reviewRounds, 1, 'the fold still reports what it spent')

  assert.deepEqual(result.epic.openQuestions, [], 'the folded question is cleared by the wake, not by the coordinator')
  assert.deepEqual(result.epic.unsettled, [], 'and an answered INCONCLUSIVE claim with it')
  assert.deepEqual(result.epic.answers, [], 'the answers are consumed')
  assert.match(logs.join('\n'), /Folded 2 answered question\(s\)/)
  assert.deepEqual(
    result.blockers.filter((b) => /open question|INCONCLUSIVE/.test(b.blocker)),
    [],
    'and the human is not asked again',
  )
})

check('an answered epic question survives a dead fold', async () => {
  // The clearing is what makes the fold load-bearing: consume the answer without applying it and the
  // question is gone AND the spec is unchanged, which is worse than either alone.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      epic: {
        issueId: 'FIX-1',
        name: 'thing',
        branch: 'epic/thing',
        prNumber: 100,
        openQuestions: ['one store or two?'],
        answers: [{ question: 'one store or two?', answer: 'one, scoped per tenant' }],
      },
      issues: [row('FIX-2', { phase: 'NEEDS_SPEC' })],
    }),
    respond: epicResponder({ nulls: ['fold:epic'], fresh: { 'FIX-2': { phase: 'NEEDS_SPEC' } } }),
  })
  assert.deepEqual(result.epic.answers, [{ question: 'one store or two?', answer: 'one, scoped per tenant' }])
  assert.deepEqual(result.epic.openQuestions, ['one store or two?'], 'the question stays until an answer is actually applied')
})

check('the next sibling blocker is lifted in the same pass that clears the answered one', async () => {
  // Clearing the answered slice and its marker without re-lifting left a window: a wake with no DAG
  // work runs no worker, so nothing surfaced the next sibling, and the following refresh saw neither
  // a blocker nor a marker — then cleared a decision nobody had answered.
  const first = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          blocker: null,
          blockerFor: 'a',
          subPrs: [
            { id: 'a', status: 'open', pr: 41, branch: 'fix/a', blocker: 'which shape?' },
            { id: 'b', status: 'open', pr: 42, branch: 'fix/b', blocker: 'which owner?' },
          ],
          assembledGoal: { passed: false },
        }),
      ],
    }),
    // Deliberately no DAG work and no worker this wake — the window the old code fell into.
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'PR_FEEDBACK' } } }),
  })
  const two = first.result.issues[0]
  assert.equal(two.subPrs.find((s) => s.id === 'a').blocker, null, 'the answered slice is released')
  assert.equal(two.subPrs.find((s) => s.id === 'b').blocker, 'which owner?', 'the unanswered one is not')
  assert.match(two.blocker, /b: which owner\?/, 'and it is surfaced in the same pass, not left unmarked')
  assert.equal(two.blockerFor, 'b')

  // So the next resolution clears exactly that one, and nothing remains unmarked.
  const second = await run('epic-wake.js', {
    args: epicArgs({ issues: [{ ...two, blocker: null }] }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'PR_FEEDBACK' } } }),
  })
  assert.deepEqual(
    second.result.issues[0].subPrs.filter((s) => s.blocker),
    [],
    'both decisions answered, both slices released',
  )
  assert.equal(second.result.issues[0].blockerFor, null)
})

check('a multi-PR row is not DONE until every slice merged AND the goal passed', async () => {
  // Each condition is necessary and neither is sufficient. A worker can report `passed: true` while a
  // slice is still open, which would stop all DAG dispatch and let Linear and the epic wrap first.
  for (const subPrs of [
    [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a' }, { id: 'b', status: 'open', pr: 42, branch: 'fix/b' }],
    [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a' }, { id: 'b', status: 'pending', pr: null, branch: null }],
  ]) {
    const { result } = await run('epic-wake.js', {
      args: epicArgs({ issues: [row('FIX-2', { phase: 'PR_FEEDBACK', subPrs, assembledGoal: { passed: true, evidence: 'ran it' } })] }),
      respond: epicResponder({ fresh: { 'FIX-2': { phase: 'PR_FEEDBACK' } } }),
    })
    assert.equal(result.issues[0].phase, 'PR_FEEDBACK', 'a passed goal does not finish an unmerged DAG')
  }

  // Both conditions met.
  const done = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'PR_FEEDBACK', subPrs: [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a' }], assembledGoal: { passed: true, evidence: 'ran it' } })],
    }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'PR_FEEDBACK' } } }),
  })
  assert.equal(done.result.issues[0].phase, 'DONE')
})

check('a worker sub-PR table is merged into the durable one, never substituted', async () => {
  // A compact row that omits `dependsOn` would leave the slice reading as dependency-free — built
  // straight onto origin/main while its prerequisite is still unmerged.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          subPrs: [
            { id: 'a', status: 'open', pr: 41, branch: 'fix/a', dependsOn: [] },
            { id: 'b', status: 'pending', pr: null, branch: null, dependsOn: ['a'] },
          ],
          assembledGoal: { passed: false },
          multiPrPending: true,
        }),
      ],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK' } },
      // Compact report: only what changed, and no edges.
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', subPrs: [{ id: 'b', status: 'open', pr: 42, branch: 'fix/b' }] } },
    }),
  })
  const subPrs = result.issues[0].subPrs
  assert.deepEqual(subPrs.find((s) => s.id === 'b').dependsOn, ['a'], 'the DAG edge survives a compact report')
  assert.equal(subPrs.find((s) => s.id === 'b').pr, 42, 'and the reported change is applied')
  assert.ok(subPrs.find((s) => s.id === 'a'), 'a row the worker said nothing about is not dropped')
})

check('an in-session approval is refused when a live scan returns no head', async () => {
  // The epic gate already fails closed here; this is the issue-level twin. Falling back to the
  // carried head would approve against a SHA the live scan just failed to confirm.
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7, approvedInSession: 'head1', headSha: 'head1' })],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specApproved: false, specPr: 7, headSha: null } },
    }),
  })
  assert.deepEqual(workerLabels(calls), [], 'a live scan with no head confirms nothing')
  assert.equal(result.issues[0].specApproved, false)

  // A DEAD scout confirms nothing either, so it releases nothing — this half formerly asserted the
  // opposite, falling back to the carried head so an approval was not "lost to an outage". That reasoning
  // conflated losing the approval with declining to ACT on it: the approval is still persisted, and a push
  // no scan has seen is precisely what the carried head cannot rule out. The epic gate was corrected the
  // same way; this is its issue-level twin.
  const dead = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7, approvedInSession: 'head1', headSha: 'head1' })],
    }),
    respond: epicResponder({ nulls: ['refresh:FIX-2'], worker: { 'FIX-2': { phase: 'NEEDS_IMPLEMENTATION', specPr: 7 } } }),
  })
  assert.deepEqual(workerLabels(dead.calls), [], 'held for this wake')
  assert.equal(dead.result.issues[0].approvedInSession, 'head1', 'and the approval itself is kept')

  // The next wake with a usable scan releases it, so the hold is per-wake and not a lost approval.
  const recovered = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7, approvedInSession: 'head1', headSha: 'head1' })],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specApproved: false, specPr: 7, headSha: 'head1' } },
      worker: { 'FIX-2': { phase: 'NEEDS_IMPLEMENTATION', specPr: 7 } },
    }),
  })
  assert.deepEqual(workerLabels(recovered.calls), ['implement:FIX-2'])
})

check('a multi-PR scan that omits per-handle state consumes nothing', async () => {
  // The prompt asks for one entry per handle, so an omission means the scan didn't look. Consuming
  // the batch anyway loses a just-merged slice: the merge is never persisted while the feedback
  // worker eats the activity that announced it, and the dependent slice then parks with no event
  // coming. A single-PR row is unaffected — requiring the field of every scan would be a tax.
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          subPrs: [{ id: 'a', status: 'open', pr: 41, branch: 'fix/a' }],
          assembledGoal: { passed: false },
          lastSeenActivityAt: 'old',
        }),
      ],
    }),
    respond: epicResponder({
      // Activity reported, per-handle state absent.
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', newPrEvents: true, latestActivityAt: 'new' } },
    }),
  })
  assert.deepEqual(labels(calls, 'pr-feedback:'), [], 'an incomplete observation does not consume the batch')
  assert.equal(result.issues[0].lastSeenActivityAt, 'old', 'and the cursor holds so a later scan re-derives it')
  assert.equal(result.issues[0].newPrEvents, true)

  // A single-PR row with no sub-PRs is unaffected by the rule.
  const single = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-3', { phase: 'PR_FEEDBACK', implPr: 9, lastSeenActivityAt: 'old' })] }),
    respond: epicResponder({
      fresh: { 'FIX-3': { phase: 'PR_FEEDBACK', newPrEvents: true, latestActivityAt: 'new', implPr: 9 } },
      worker: { 'FIX-3': { phase: 'PR_FEEDBACK', implPr: 9 } },
    }),
  })
  assert.deepEqual(workerLabels(single.calls), ['pr-feedback:FIX-3'])
})

check('a headless scan does not erase the last confirmed head', async () => {
  // Persisting the null meant a dead scout on the NEXT wake read "no observed head" as compatible
  // with any in-session approval — implementation dispatched without the approved head confirmed.
  const first = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7, approvedInSession: 'head1', headSha: 'head2' })],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specApproved: false, specPr: 7, headSha: null } },
    }),
  })
  assert.equal(first.result.issues[0].headSha, 'head2', 'the last thing actually observed survives')

  // So a dead scout next wake still knows the approved SHA is stale.
  const second = await run('epic-wake.js', {
    args: epicArgs({ issues: [{ ...first.result.issues[0] }] }),
    respond: epicResponder({ nulls: ['refresh:FIX-2'] }),
  })
  assert.deepEqual(workerLabels(second.calls), [], 'a known-newer head still invalidates the approval')
})

check('a partial assembledGoal report merges into the carried state', async () => {
  // The schema permits a partial object, so a worker reporting only `{ fixPr }` would otherwise drop
  // the failure, the gap issue and the evidence — and the next wake would re-run the goal.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          subPrs: [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a' }],
          assembledGoal: { passed: false, failure: 'stream closed early', evidence: 'ran it', fixIssue: 'FIX-50' },
          multiPrPending: true,
        }),
      ],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', subPrStates: [{ id: 'a', merged: true, readyToMerge: false }] } },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', assembledGoal: { fixPr: 42 } } },
    }),
  })
  const goal = result.issues[0].assembledGoal
  assert.equal(goal.fixPr, 42, 'the reported field lands')
  assert.equal(goal.failure, 'stream closed early', 'and the carried state it said nothing about survives')
  assert.equal(goal.evidence, 'ran it')
  assert.equal(goal.fixIssue, 'FIX-50')
})

check('fold-held work is returned so the coordinator re-enters instead of waiting', async () => {
  // The hold defers work one wake, which is only true if something tells the coordinator to run
  // another wake. Without this the turn ends and the next wake depends on unrelated PR activity —
  // a wait with no path out, which is what the hold was not supposed to introduce.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      epic: { issueId: 'FIX-1', branch: 'epic/t', prNumber: 100, reviewRounds: 0 },
      issues: [row('FIX-2')],
    }),
    respond: epicResponder({ epicReviewEvents: true, fresh: { 'FIX-2': { phase: 'NEEDS_SPEC' } } }),
  })
  assert.deepEqual(result.heldForFold, [{ issueId: 'FIX-2', action: 'spec' }])
})

check("the fold's open questions reach the human instead of being rejected", async () => {
  // The epic-agent's own contract tells it to return open questions when a cross-cutting decision
  // needs a human. Without the field in the schema, `additionalProperties: false` rejects that whole
  // response — the harness returns null, the wake reads "the fold died" and retries forever, and the
  // question never reaches anyone.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({ epic: { issueId: 'FIX-1', branch: 'epic/t', prNumber: 100, reviewRounds: 0 }, issues: [] }),
    respond: epicResponder({
      epicReviewEvents: true,
      fold: { roundsSpent: 1, aboveBar: true, openQuestions: ['Do we keep the v1 transport or drop it?'] },
    }),
  })
  assert.deepEqual(result.epic.openQuestions, ['Do we keep the v1 transport or drop it?'], 'carried durably')
  assert.ok(
    result.blockers.some((b) => /open question — needs a human: Do we keep the v1 transport/.test(b.blocker)),
    'and surfaced to the coordinator',
  )

  // Still surfaced next wake — a question shown once and forgotten is a decision lost.
  const second = await run('epic-wake.js', {
    args: epicArgs({ epic: { ...result.epic }, issues: [] }),
    respond: epicResponder({}),
  })
  assert.equal(second.result.epic.openQuestions.length, 1, 'carried, not duplicated')
  assert.ok(second.result.blockers.some((b) => /open question/.test(b.blocker)))
})

check('a PARTIAL per-handle scan consumes nothing either', async () => {
  // "Non-empty" is not "complete": one entry out of three passed the first version of this guard, and
  // if the omitted handle is the one that merged, the merge is lost while the batch is consumed.
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          subPrs: [
            { id: 'a', status: 'open', pr: 41, branch: 'fix/a' },
            { id: 'b', status: 'open', pr: 42, branch: 'fix/b' },
          ],
          assembledGoal: { passed: false },
          lastSeenActivityAt: 'old',
        }),
      ],
    }),
    respond: epicResponder({
      // Only one of the two handles reported.
      fresh: {
        'FIX-2': {
          phase: 'PR_FEEDBACK',
          newPrEvents: true,
          latestActivityAt: 'new',
          subPrStates: [{ id: 'a', merged: false, readyToMerge: false }],
        },
      },
    }),
  })
  assert.deepEqual(labels(calls, 'pr-feedback:'), [], 'a partial observation does not consume the batch')
  assert.equal(result.issues[0].lastSeenActivityAt, 'old')
})

check('an implement dispatch keeps the spec PR open while a settlement is live', async () => {
  // A late REFUTED verdict has to be folded into the spec and replied to on its thread, so closing
  // the artifact on the way into implementation destroys what the fold needs.
  const { calls } = await run('epic-wake.js', {
    args: epicArgs({
      cap: 3,
      issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7 })],
      settleRequests: [{ claim: 'does the router re-enter?', load: 'x', falsify: 'y', threads: 't', issueId: 'FIX-2' }],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specApproved: true, specPr: 7 } },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9, specPr: 7 } },
    }),
  })
  const prompt = calls.find((c) => c.label === 'implement:FIX-2').prompt
  assert.match(prompt, /settlement is IN FLIGHT on a load-bearing claim/)
  assert.match(prompt, /do NOT close or delete the spec PR/)
  assert.match(prompt, /does the router re-enter\?/)
})

check('a stacked sub-PR is not offered for merge before its rebase', async () => {
  // Its base is the prerequisite's branch, so merging lands it into that branch (or makes the
  // prerequisite's PR carry both slices) and pre-empts the rebase the DAG still has to schedule.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          subPrs: [
            { id: 'a', status: 'open', pr: 41, branch: 'fix/a', stackedOn: null },
            { id: 'b', status: 'open', pr: 42, branch: 'fix/b', stackedOn: 'fix/a' },
          ],
          assembledGoal: { passed: false },
        }),
      ],
    }),
    respond: epicResponder({
      fresh: {
        'FIX-2': {
          phase: 'PR_FEEDBACK',
          subPrStates: [
            { id: 'a', merged: false, readyToMerge: true },
            { id: 'b', merged: false, readyToMerge: true },
          ],
        },
      },
    }),
  })
  assert.deepEqual(result.gates, [{ kind: 'merge', issueId: 'FIX-2', pr: 41, subPr: 'a' }], 'only the unstacked slice is mergeable')
})

check('activity reported with no timestamp withholds the work rather than consuming it', async () => {
  // Dispatching anyway consumes the batch (a round spent, or PR fixes applied) while the cursor
  // stays put, so the next wake rediscovers exactly the same feedback and does it again.
  for (const flag of ['newSpecReviewEvents', 'newPrEvents']) {
    const phase = flag === 'newSpecReviewEvents' ? 'AWAITING_SPEC_APPROVAL' : 'PR_FEEDBACK'
    const { result, calls } = await run('epic-wake.js', {
      args: epicArgs({ issues: [row('FIX-2', { phase, specPr: 7, implPr: 9, lastSeenActivityAt: 'old' })] }),
      respond: epicResponder({
        fresh: { 'FIX-2': { phase, [flag]: true, specPr: 7, implPr: 9, latestActivityAt: null } },
      }),
    })
    assert.deepEqual(workerLabels(calls), [], `${flag} with no timestamp must not dispatch`)
    assert.equal(result.issues[0].lastSeenActivityAt, 'old')
    assert.equal(result.issues[0][flag], true, 'the flag stays live so a later scan re-derives it')
  }

  // A CI failure is not comment activity and needs no timestamp — it must still be actionable.
  const { calls } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9 })] }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', ciFailed: true, implPr: 9, latestActivityAt: null } } }),
  })
  assert.deepEqual(workerLabels(calls), ['pr-feedback:FIX-2'])
})

check('per-handle readiness observed before a worker ran is not offered for merge', async () => {
  // A pr-feedback worker pushes commits, which invalidates the approval and re-runs the checks the
  // observation was based on — surfacing it would tell the human to merge an unverified head.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          subPrs: [{ id: 'a', status: 'open', pr: 41, branch: 'fix/a' }],
          assembledGoal: { passed: false },
          lastSeenActivityAt: 'old',
        }),
      ],
    }),
    respond: epicResponder({
      // Green at scan time, and the SAME batch carries review feedback the worker will act on.
      fresh: {
        'FIX-2': {
          phase: 'PR_FEEDBACK',
          newPrEvents: true,
          latestActivityAt: 'new',
          subPrStates: [{ id: 'a', merged: false, readyToMerge: true }],
        },
      },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK' } },
    }),
  })
  assert.deepEqual(result.gates, [], 'the pre-worker observation is void once a worker has run')
  assert.deepEqual(result.issues[0].subPrStates, [])
})

check('a review worker that escalates is not charged its round either', async () => {
  // The cursor already holds for a blocked worker; this counter has to agree. Charged anyway, one
  // round becomes two and the retained batch reads as converged once the human answers.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7, specReviewRounds: 1, lastSeenActivityAt: 'old' })],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', newSpecReviewEvents: true, specPr: 7, latestActivityAt: 'new' } },
      worker: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7, specReviewRoundsSpent: 1, blocker: 'which approach?' } },
    }),
  })
  assert.equal(result.issues[0].specReviewRounds, 1, 'the round is not spent on a round that did not finish')
  assert.equal(result.issues[0].lastSeenActivityAt, 'old', 'and the batch is still live, consistently')
})

check('a worker transition without its durable handle is refused', async () => {
  for (const [phase, handle] of [
    ['AWAITING_SPEC_APPROVAL', 'specPr'],
    ['PR_FEEDBACK', 'implPr'],
  ]) {
    const { result } = await run('epic-wake.js', {
      args: epicArgs({ issues: [row('FIX-2', { phase: 'NEEDS_SPEC' })] }),
      respond: epicResponder({
        fresh: { 'FIX-2': { phase: 'NEEDS_SPEC' } },
        // Schema-valid, but the handle the phase depends on is absent.
        worker: { 'FIX-2': { phase } },
      }),
    })
    assert.equal(result.issues[0].phase, 'NEEDS_SPEC', `${phase} without ${handle} must not be accepted`)
    assert.deepEqual(
      result.gates.filter((g) => g.pr === null || g.pr === undefined),
      [],
      'and no gate is surfaced with nothing to open',
    )
  }

  // A multi-PR row is the deliberate exception: its handles are the sub-PR table, not `implPr`.
  const multi = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'NEEDS_IMPLEMENTATION' })] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'NEEDS_IMPLEMENTATION', specApproved: true } },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', subPrs: [{ id: 'a', status: 'open', pr: 41, branch: 'fix/a' }] } },
    }),
  })
  assert.equal(multi.result.issues[0].phase, 'PR_FEEDBACK')
})

check('converged epic feedback is not re-routed when the cursor cannot move', async () => {
  // The guard was only on the fold, so a converged epic re-read and re-routed the same comments as
  // implementer notes on every wake — the routing path advances no cursor of its own.
  const { calls, result } = await run('epic-wake.js', {
    args: epicArgs({
      epic: { issueId: 'FIX-1', branch: 'epic/t', prNumber: 100, reviewRounds: 2, lastSeenActivityAt: 'old' },
      issues: [],
    }),
    respond: (prompt, opts) => {
      const label = opts.label || ''
      if (label === 'gate:epic') return { approved: true, approvedByLabel: false, headSha: 'abc', newReviewEvents: true, latestActivityAt: null }
      if (label === 'linear:epic-children') return { issues: [] }
      return { notes: [] }
    },
  })
  assert.deepEqual(labels(calls, 'route:epic-notes'), [], 'nothing is re-routed off a cursor that cannot advance')
  assert.equal(result.epic.lastSeenActivityAt, 'old')
})

check('epic activity reported without a timestamp is not folded and lost', async () => {
  // The cursor could not advance past it, so the batch would be rediscovered and re-charged every
  // wake until the budget converged — spending the whole budget on one batch.
  const { result, calls, logs } = await run('epic-wake.js', {
    args: epicArgs({ epic: { issueId: 'FIX-1', branch: 'epic/t', prNumber: 100, reviewRounds: 0, lastSeenActivityAt: 'old' }, issues: [] }),
    respond: (prompt, opts) => {
      const label = opts.label || ''
      if (label === 'gate:epic') return { approved: true, approvedByLabel: false, headSha: 'abc', newReviewEvents: true, latestActivityAt: null }
      if (label === 'linear:epic-children') return { issues: [] }
      return {}
    },
  })
  assert.deepEqual(labels(calls, 'fold:epic'), [], 'no round is spent on a batch that cannot be consumed')
  assert.equal(result.epic.reviewRounds, 0)
  assert.equal(result.epic.lastSeenActivityAt, 'old', 'and the cursor holds so it is genuinely re-derived')
  assert.match(logs.join('\n'), /new review activity with no timestamp/)
})

check('a terminal issue stops asking the human to approve its spec', async () => {
  const { result } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7 })] }),
    respond: (prompt, opts) => {
      const label = opts.label || ''
      if (label === 'gate:epic') return { approved: true, approvedByLabel: false, headSha: 'abc', newReviewEvents: false, latestActivityAt: '2026-07-05T00:00:00Z' }
      if (label === 'linear:epic-children') return { issues: [{ id: 'FIX-2', state: 'Canceled', blockedBy: [] }] }
      if (label.startsWith('refresh:')) return { issueId: 'FIX-2', ...freshRow({ phase: 'AWAITING_SPEC_APPROVAL', specPr: 7 }) }
      return workerRes({ issueId: 'FIX-2' })
    },
  })
  assert.deepEqual(result.gates, [], 'a cancelled child needs no spec approval')
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
    // The RE-CHECK has its own readiness-only schema — it files nothing, so `issueFiled` is not part
    // of its contract. Sharing the filing fixture is what hid the prompt/schema disagreement: the
    // stub answered in a shape the real hook would have rejected as null.
    recheck = null,
    fix = { pr: 42 },
    nulls = [],
  } = {}) =>
  (prompt, opts) => {
    const label = opts.label || ''
    if (nulls.some((n) => label.startsWith(n))) return null
    if (label.startsWith('assembled-goal:')) return goal
    if (label.startsWith('gap-recheck:')) return recheck || { ready: gap.ready }
    if (label.startsWith('assembled-gap:')) return gap
    if (label.startsWith('assembled-fix:')) return fix
    const id = label.split(':')[1]
    return { id, status: 'open', pr: 1, branch: `fix/FIX-9-${id}`, ...(build[id] || {}) }
  }

check('an answered blocker on an already-OPEN slice gets a worker to apply it', async () => {
  // Clearing the blocker was not enough, and was worse than the stall it replaced: `classify` has no
  // action for an ordinary open node, so nothing consumed the answer — while the slice, now reading as
  // unblocked, became eligible for a merge gate. The human would be asked to merge an implementation
  // that ignores the decision they were asked for. A stall is recoverable; that is not.
  const { calls } = await run('issue-multi-pr.js', {
    args: multiArgs({
      subPrs: [{ id: 'a', status: 'open', pr: 41, branch: 'fix/a', dependsOn: [], blocker: 'which shape?' }],
      blockerResolutions: [{ for: 'a', answer: 'key on tenant + scope' }],
    }),
    respond: multiResponder(),
  })
  const resume = calls.find((c) => c.label === 'resume:a')
  assert.ok(resume, 'an open slice with an answered decision is dispatched, not left silently unblocked')
  assert.match(resume.prompt, /Apply the decision to that EXISTING PR/)
  // A fresh worktree starts on the lifecycle's checkout, not on this sub-PR — the build path already
  // warns about that drift, and these two paths, the ones operating on an EXISTING branch, did not.
  assert.match(resume.prompt, /Fetch and check out fix\/a first/)
  assert.match(resume.prompt, /Do not open a new PR and do not merge it/)
  assert.match(resume.prompt, /key on tenant \+ scope/)

  // And without an answer it stays parked — otherwise the case above proves nothing.
  const parked = await run('issue-multi-pr.js', {
    args: multiArgs({ subPrs: [{ id: 'a', status: 'open', pr: 41, branch: 'fix/a', dependsOn: [], blocker: 'which shape?' }] }),
    respond: multiResponder(),
  })
  assert.deepEqual(parked.calls.filter((c) => /^(resume|build|rebase):/.test(c.label || '')), [])
})

check('a step with nothing runnable names the wait, so the caller stops re-invoking', async () => {
  // `issue-lifecycle` runs another step unless the result NAMES a wait. This return named none, and the
  // state it covers is the one a multi-PR issue spends most of its life in — every slice built, every PR
  // open, nothing left but merges the human owns. Standalone, that was an infinite loop on an identical
  // result. Under an epic it was survivable only because the worker reports `multiPrPending` instead.
  const open = await run('issue-multi-pr.js', {
    args: multiArgs({
      subPrs: [
        { id: 'a', status: 'open', pr: 41, branch: 'fix/a', dependsOn: [] },
        { id: 'b', status: 'open', pr: 42, branch: 'fix/b', dependsOn: [] },
      ],
    }),
    respond: multiResponder(),
  })
  assert.deepEqual(open.result.dispatched, [], 'nothing is runnable')
  assert.deepEqual(open.result.awaiting.merge, ['a', 'b'], 'and the wait is the human merge gate on both')
  assert.deepEqual(open.result.awaiting.decision, [])
  assert.deepEqual(open.result.awaiting.plan, [])

  // A slice waiting on a HUMAN and a slice waiting on a MERGE are different waits, and the coordinator
  // acts differently on them — one is a question to put, the other is nothing to say. `merge` claiming the
  // blockered slice would ask for a merge on a PR whose fork is unsettled.
  const mixed = await run('issue-multi-pr.js', {
    args: multiArgs({
      subPrs: [
        { id: 'a', status: 'open', pr: 41, branch: 'fix/a', dependsOn: [], blocker: 'which shape?' },
        { id: 'b', status: 'pending', dependsOn: ['a'] },
      ],
    }),
    respond: multiResponder(),
  })
  assert.deepEqual(mixed.result.awaiting.decision, [{ id: 'a', blocker: 'which shape?' }])
  assert.deepEqual(mixed.result.awaiting.merge, ['b'], "b is pending behind a's merge — a merge wait, and it is not runnable")

  // A malformed plan is NOT a wait: no merge and no answer can resolve a cycle, only a human editing the
  // table. Reporting it under `merge` would tell the coordinator to sit on a merge gate that can never
  // arrive — the over-correction of naming every live node.
  const cycle = await run('issue-multi-pr.js', {
    args: multiArgs({
      subPrs: [
        { id: 'a', status: 'pending', dependsOn: ['b'] },
        { id: 'b', status: 'pending', dependsOn: ['a'] },
      ],
    }),
    respond: multiResponder(),
  })
  assert.deepEqual(cycle.result.awaiting.plan.sort(), ['a', 'b'])
  assert.deepEqual(cycle.result.awaiting.merge, [], 'a cycle waits on a human editing the plan, not on a merge')

  // The other half of the same rule, and the stall this marker could reintroduce: a step that DISPATCHED
  // must not name a wait. Cap-deferred slices are pending, have no PR, and nothing external will ever
  // wake them — so a marker on this path would end the turn and strand them.
  const dispatching = await run('issue-multi-pr.js', {
    args: multiArgs({
      cap: 1,
      subPrs: [
        { id: 'a', status: 'pending', dependsOn: [] },
        { id: 'b', status: 'pending', dependsOn: [] },
      ],
    }),
    respond: multiResponder(),
  })
  assert.deepEqual(dispatching.result.deferred, ['b'])
  assert.equal(dispatching.result.awaiting, undefined, 'a step that ran is never a wait, whatever it held back')
})

check("INVARIANT: every wait `issue-lifecycle` stops on is one the workflow can emit", async () => {
  const src = readFileSync(join(HERE, 'issue-multi-pr.js'), 'utf8')
  const skill = readFileSync(join(HERE, '..', 'skills', 'issue-lifecycle', 'SKILL.md'), 'utf8')
  // The re-invoke rule is NEGATIVE — another step unless the result names a wait — so drift is a stall in
  // whichever direction it happens: a return path naming no wait loops forever, and a wait the skill lists
  // but the script never emits ends the turn on a condition that cannot arrive. Both ends, mechanically.
  // The rule is asserted on the FLATTENED text (markdown wraps it mid-sentence) and the list is parsed
  // from the raw lines, so the anchor is the short fragment that survives both.
  assert.match(
    skill.replace(/\s+/g, ' '),
    /Run another step unless the result carries one of:/,
    'the re-invoke rule moved — repoint this invariant',
  )
  const ANCHOR = 'carries one of:'
  assert.ok(skill.includes(ANCHOR), 'the list anchor wrapped — repoint this invariant')
  const after = skill.slice(skill.indexOf(ANCHOR) + ANCHOR.length)
  const listed = []
  for (const line of after.split('\n')) {
    // `[^`]*` because a bullet names the shape it stops on, not just the field: `done: true`.
    const m = /^- `([A-Za-z]+)[^`]*`/.exec(line)
    if (m) listed.push(m[1])
    else if (listed.length && !line.trim()) break
  }
  assert.ok(
    listed.length >= 4 && listed.includes('done'),
    `expected the skill's wait list, parsed ${JSON.stringify(listed)}`,
  )
  assert.ok(listed.includes('awaiting'), 'the no-step return names its wait; the skill has to recognise it')
  for (const wait of listed) {
    assert.match(src, new RegExp(`\\b${wait}[,:]`), `the skill stops on \`${wait}\` but the workflow never returns it`)
  }
})

check('an unapplied decision withholds that slice\'s merge gate', async () => {
  // The other half of the same defect: until the resume worker has run, the PR is an implementation
  // that ignores the decision. `readyToMerge` on it is true and says nothing about that.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          subPrs: [
            { id: 'a', status: 'open', pr: 41, branch: 'fix/a' },
            { id: 'b', status: 'open', pr: 42, branch: 'fix/b' },
          ],
          blockerResolutions: [{ for: 'a', answer: 'key on tenant + scope' }],
        }),
      ],
    }),
    respond: epicResponder({
      fresh: {
        'FIX-2': {
          phase: 'PR_FEEDBACK',
          subPrStates: [
            { id: 'a', merged: false, readyToMerge: true },
            { id: 'b', merged: false, readyToMerge: true },
          ],
        },
      },
      // DEAD, deliberately. A queued answer is now dispatchable work, and a worker that RUNS voids the
      // pre-worker readiness for the whole row — so the per-slice guard would be invisible behind that.
      // A dead worker mutates nothing, so the scan's per-handle readiness survives and this guard is
      // what decides each slice. That is also the state where it matters most: nothing applied the
      // answer, so nothing should invite the human to merge the slice waiting on it.
      nulls: ['implement:FIX-2'],
    }),
  })
  assert.deepEqual(
    result.gates.filter((g) => g.kind === 'merge').map((g) => g.subPr),
    ['b'],
    "the slice whose decision is unapplied is not offered; its sibling still is",
  )
})

check('a repair blocker is lifted to the row so the resolution rule cannot erase it', async () => {
  // The THIRD copy of the same decision. A repair worker escalates via `assembledGoal.fixBlocker`; the
  // outer worker has no obligation to also set the top-level `blocker`, and the lift only read
  // `subPrs[]`. So the decision was never surfaced — and the next refresh, reading an absent row blocker
  // as "the human answered", cleared `fixBlocker` and let the repair run through an unanswered fork.
  const escalated = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          subPrs: [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a' }],
          assembledGoal: { passed: false, failure: 'disagree on the cache key', evidence: 'ran it' },
          multiPrPending: true,
        }),
      ],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', subPrStates: [{ id: 'a', merged: true, readyToMerge: false }] } },
      // The worker reports the repair escalation and NOTHING at the row level — schema-valid.
      worker: {
        'FIX-2': {
          phase: 'PR_FEEDBACK',
          multiPrPending: false,
          assembledGoal: { fixBlocker: 'which shape should the key take?' },
        },
      },
    }),
  })
  const escalatedRow = escalated.result.issues[0]
  assert.match(escalatedRow.blocker || '', /which shape should the key take\?/, 'the escalation is surfaced')
  assert.ok(
    escalated.result.blockers.some((b) => /which shape should the key take\?/.test(b.blocker)),
    'and reaches the human',
  )

  // Next wake, unanswered: the row blocker is set, so nothing clears the nested copy.
  const stillOpen = await run('epic-wake.js', {
    args: epicArgs({ issues: [{ ...escalatedRow }] }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', subPrStates: [{ id: 'a', merged: true, readyToMerge: false }] } } }),
  })
  assert.equal(stillOpen.result.issues[0].assembledGoal.fixBlocker, 'which shape should the key take?')
  assert.deepEqual(workerLabels(stillOpen.calls), [], 'and the row stays parked')
})

check('an assembled goal that passed without evidence is not DONE, and re-runs', async () => {
  // The inner GOAL_SCHEMA requires `evidence` because a bare boolean is not a proof, but the outer
  // WORKER_SCHEMA carries `assembledGoal` as a free-form object — so `{ passed: true }` is schema-valid
  // at the epic boundary and marked the issue complete without the proof the phase exists to produce.
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          subPrs: [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a' }],
          assembledGoal: { passed: true },
          multiPrPending: false,
        }),
      ],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', subPrStates: [{ id: 'a', merged: true, readyToMerge: false }] } },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', multiPrPending: false } },
    }),
  })
  assert.equal(result.issues[0].phase, 'PR_FEEDBACK', 'a pass with no evidence does not finish the issue')
  // ...and it is treated as NOT RUN rather than refused, so the goal is re-run instead of the row
  // parking between the two rules — which is how an earlier fix here turned a bypass into a stall.
  assert.deepEqual(workerLabels(calls), ['implement:FIX-2'], 'the goal is re-run')

  const withEvidence = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          subPrs: [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a' }],
          assembledGoal: { passed: true, evidence: 'fsdev run: PASS' },
        }),
      ],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', subPrStates: [{ id: 'a', merged: true, readyToMerge: false }] } },
    }),
  })
  assert.equal(withEvidence.result.issues[0].phase, 'DONE')
})

check('a fold that revised the objective withholds this wake\'s child gates', async () => {
  // The gate is scanned before the fold pushes, so the approval this wake emitted gates from is already
  // stale — a push after approval re-opens the gate, and the fold IS a push. `heldForFold` does not
  // cover it: that defers WORK, and a wake whose children are all merely awaiting a human gate holds
  // nothing and still emits those gates. A child spec approval is durable, so accepting one releases
  // implementation against an objective nobody signed off.
  const { result, logs } = await run('epic-wake.js', {
    args: epicArgs({
      epic: { issueId: 'FIX-1', name: 'thing', branch: 'epic/thing', prNumber: 100, reviewRounds: 0, lastSeenActivityAt: 'old' },
      issues: [
        row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 }),
        row('FIX-3', { phase: 'PR_FEEDBACK', implPr: 9 }),
      ],
    }),
    respond: epicResponder({
      epicReviewEvents: true,
      fold: { roundsSpent: 1, aboveBar: true, folded: 'narrowed the objective', fanOut: [] },
      fresh: {
        'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 },
        'FIX-3': { phase: 'PR_FEEDBACK', implPr: 9, readyToMerge: true },
      },
    }),
  })
  assert.deepEqual(
    result.gates.filter((g) => g.kind !== 'epic-objective'),
    [],
    'no child spec-approval or merge gate is emitted against a pre-fold approval',
  )
  assert.equal(result.epic.headUnconfirmed, true, 'and the moved head is marked so the next wake re-scans it')
  assert.match(logs.join('\n'), /withholding child spec-approval and merge gates/)

  // A ZERO-ROUND fold withholds too, and that is the point rather than an accident. This sub-case used to
  // assert the opposite — that a fold reporting `roundsSpent: 0` and an empty `folded` left the gates
  // alone — which was the hole: a verdict fold and an answer fold are TOLD to report zero rounds, and
  // those are the two folds most certain to have written the epic-spec.
  const zeroRound = await run('epic-wake.js', {
    args: epicArgs({
      epic: { issueId: 'FIX-1', name: 'thing', branch: 'epic/thing', prNumber: 100, verdicts: [{ claim: 'c', verdict: 'CONFIRMED', evidence: 'e' }] },
      issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 })],
    }),
    respond: epicResponder({
      // BOTH signals absent, which is the hole: `folded` empty and zero rounds, exactly what a verdict or
      // answer fold is told to report. Under the old keying this emitted gates against a stale approval.
      fold: { roundsSpent: 0, aboveBar: false, folded: '', fanOut: [] },
      fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 } },
    }),
  })
  assert.deepEqual(zeroRound.result.gates.filter((g) => g.kind === 'spec-approval'), [], 'a verdict fold wrote, so it withholds')
  // And the fold always REPORTS what it did, since `folded` is the coordinator's only window into an
  // artifact it deliberately never reads. Asserted as a contract rather than a behaviour: nothing branches
  // on it any more (that is the point of keying the guard on the fold having returned at all), so no
  // fixture could tell required from optional.
  assert.ok(
    loadSchemas('epic-wake.js').EPIC_FOLD_SCHEMA.required.includes('folded'),
    'a fold that reports nothing about what it changed leaves the coordinator blind',
  )

  // What actually discriminates is whether a fold ran AT ALL. A quiet wake must not stall the epic's
  // gates, or the withholding would never lift.
  const noFold = await run('epic-wake.js', {
    args: epicArgs({
      epic: { issueId: 'FIX-1', name: 'thing', branch: 'epic/thing', prNumber: 100 },
      issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 })],
    }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 } } }),
  })
  assert.deepEqual(labels(noFold.calls, 'fold:epic'), [], 'no fold this wake')
  assert.deepEqual(noFold.result.gates.filter((g) => g.kind === 'spec-approval').map((g) => g.pr), [8])
  assert.equal(noFold.result.epic.headUnconfirmed, false, 'and the head is not marked stale by a fold that never ran')
})

check('the documented snake_case cache fields are read, not silently ignored', async () => {
  // Three fields the prose has always spelled with underscores, which the scripts introduced camelCase
  // for without converting. A coordinator following its own documented cache format is the caller here.
  // `depends_on` is the dangerous one: read as empty, `readySet` treats the node as having all deps
  // merged and builds a dependent straight onto origin/main beside its unmerged prerequisite.
  const { calls } = await run('issue-multi-pr.js', {
    args: multiArgs({
      subPrs: [
        { id: 'a', status: 'pending' },
        { id: 'b', status: 'pending', depends_on: ['a'] },
      ],
    }),
    respond: multiResponder(),
  })
  assert.deepEqual(
    calls.filter((c) => (c.label || '').startsWith('build:')).map((c) => c.label),
    ['build:a'],
    'the dependent is held back by an edge spelled the documented way',
  )

  // And the review budget counters, whose loss silently grants a fresh two rounds — the unbounded
  // review sequence the budget exists to prevent. Both are at budget under their documented names.
  const resumed = await run('epic-wake.js', {
    args: epicArgs({
      epic: { issueId: 'FIX-1', name: 'thing', branch: 'epic/thing', prNumber: 100, epic_review_rounds: 2, aboveBarFound: false, lastSeenActivityAt: 'old' },
      // Built without `row()` on purpose: its camelCase default would sit alongside the legacy key, and
      // an explicit camel value rightly wins — so the fixture would not be a legacy row at all.
      issues: [{ id: 'FIX-2', phase: 'AWAITING_SPEC_APPROVAL', specPr: 8, spec_review_rounds: 2, specLevelFound: false }],
    }),
    respond: epicResponder({
      epicReviewEvents: true,
      fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8, newSpecReviewEvents: true, latestActivityAt: 'new' } },
    }),
  })
  assert.deepEqual(workerLabels(resumed.calls), [], 'a converged spec spends no further round')
  assert.deepEqual(labels(resumed.calls, 'fold:epic'), [], 'nor does a converged epic')
  assert.deepEqual(resumed.result.converged, ['FIX-2'])
  // The carried count survives under the name the script uses, so the next wake needs no translation.
  assert.equal(resumed.result.issues[0].specReviewRounds, 2)
  assert.equal(resumed.result.epic.reviewRounds, 2)
})

check('a resume that reports failure keeps its blocker', async () => {
  // `BUILD_SCHEMA` permits `failed` and `pending`, and clearing on those lost the decision exactly like a
  // dead worker would — the caller consumes the one-shot resolution, and the next wake has neither a
  // blocker nor a resume action while the unchanged PR stays merge-eligible.
  const { result } = await run('issue-multi-pr.js', {
    args: multiArgs({
      subPrs: [{ id: 'a', status: 'open', pr: 41, branch: 'fix/a', dependsOn: [], blocker: 'which shape?' }],
      blockerResolutions: [{ for: 'a', answer: 'key on tenant + scope' }],
    }),
    respond: multiResponder({ build: { a: { status: 'failed' } } }),
  })
  assert.equal(result.subPrs[0].blocker, 'which shape?', 'a failed delivery is not a delivery')
  assert.equal(result.subPrs[0].status, 'open', 'and it does not demote the PR either')
  assert.equal(result.subPrs[0].answerApplied, undefined, 'and it does not claim the answer landed')

  // A successful resume spends it, which is what makes the above about failure and not about resumes.
  const ok = await run('issue-multi-pr.js', {
    args: multiArgs({
      subPrs: [{ id: 'a', status: 'open', pr: 41, branch: 'fix/a', dependsOn: [], blocker: 'which shape?' }],
      blockerResolutions: [{ for: 'a', answer: 'key on tenant + scope' }],
    }),
    respond: multiResponder(),
  })
  assert.equal(ok.result.subPrs[0].blocker, null)
  assert.equal(ok.result.subPrs[0].answerApplied, true, 'a success says so explicitly, which is what the caller spends')
})

check('a dependent never stacks on a dependency whose decision is unsettled', async () => {
  // Unanswered, the dependent would encode one side of a fork the human has explicitly not settled.
  // Answered, the dep's resume and this build dispatch in the SAME parallel() call, so the dependent
  // would base itself on a branch being pushed to as it reads it.
  for (const [label, resolutions] of [
    ['unanswered', []],
    ['answered this wake', [{ for: 'a', answer: 'key on tenant + scope' }]],
  ]) {
    const { calls, result } = await run('issue-multi-pr.js', {
      args: multiArgs({
        subPrs: [
          { id: 'a', status: 'open', pr: 41, branch: 'fix/a', dependsOn: [], blocker: 'which shape?' },
          { id: 'b', status: 'pending', dependsOn: ['a'] },
        ],
        blockerResolutions: resolutions,
      }),
      respond: multiResponder(),
    })
    assert.deepEqual(calls.filter((c) => (c.label || '').includes('build:b')), [], `b waits (${label})`)
    assert.equal(result.subPrs.find((n) => n.id === 'b').status, 'pending')
  }

  // Once the dep is unblocked and open, b stacks on it — the wait is one wake, not a deadlock.
  const { calls } = await run('issue-multi-pr.js', {
    args: multiArgs({
      subPrs: [
        { id: 'a', status: 'open', pr: 41, branch: 'fix/a', dependsOn: [] },
        { id: 'b', status: 'pending', dependsOn: ['a'] },
      ],
    }),
    respond: multiResponder(),
  })
  const build = calls.find((c) => (c.label || '').includes('build:b'))
  assert.ok(build && /fix\/a/.test(build.prompt), 'and it stacks on the dependency branch')
})

check('the inner and outer DONE predicates agree about evidence', async () => {
  // They disagreed, and the disagreement was worse than either being wrong alone: `epic-wake` refused DONE
  // on `{ passed: true }` with no evidence and re-dispatched, while `issue-multi-pr` saw the same state and
  // returned DONE immediately without running the goal — so the pair looped forever doing nothing.
  const { calls, result } = await run('issue-multi-pr.js', {
    args: multiArgs({
      subPrs: [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a', dependsOn: [] }],
      assembledGoal: { passed: true },
    }),
    respond: multiResponder(),
  })
  assert.deepEqual(
    calls.filter((c) => (c.label || '').startsWith('assembled-goal')).map((c) => c.label),
    ['assembled-goal:FIX-9'],
    'a bare pass re-runs the goal rather than reporting done',
  )
  // It may well finish in this same wake — the re-run produces the evidence and passes. What matters is
  // that the goal RAN; asserting `done` here would assert the re-run failed.
  assert.equal(result.assembledGoal.evidence, 'fsdev run: PASS', 'and the re-run is what supplies the missing proof')

  // With evidence it is genuinely finished, which is what makes the above about evidence and not about
  // ignoring `passed`.
  const proven = await run('issue-multi-pr.js', {
    args: multiArgs({
      subPrs: [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a', dependsOn: [] }],
      assembledGoal: { passed: true, evidence: 'fsdev run: PASS' },
    }),
    respond: multiResponder(),
  })
  assert.equal(proven.result.done, true)
  assert.deepEqual(proven.calls.filter((c) => (c.label || '').startsWith('assembled-goal')), [])
})

check('a rebase that escalates keeps its stack marker', async () => {
  // `open` alone was read as success, so a rebase that stopped on a human decision cleared the marker.
  // After the answer, `classify` picks the generic `resume`, which applies the decision but never
  // retries the rebase — and the still-stacked PR could be offered for merge and land its dependency's
  // commits, which is the exact outcome the marker exists to prevent.
  const { result } = await run('issue-multi-pr.js', {
    args: multiArgs({
      subPrs: [
        { id: 'a', status: 'merged', pr: 41, branch: 'fix/a', dependsOn: [] },
        { id: 'b', status: 'open', pr: 42, branch: 'fix/b', dependsOn: ['a'], stackedOn: 'fix/a' },
      ],
    }),
    respond: multiResponder({ build: { b: { status: 'open', blocker: 'rebase conflicts with the new cache key — which wins?' } } }),
  })
  const b = result.subPrs.find((n) => n.id === 'b')
  assert.equal(b.stackedOn, 'fix/a', 'still stacked, so the rebase is still owed')
  assert.equal(b.blocker, 'rebase conflicts with the new cache key — which wins?')
})

check('a handleless open build keeps the answered blocker too', async () => {
  // The incomplete-build early return sits one branch before the rule that says a delivery spends
  // nothing, and cleared the blocker anyway — while the outer wake, seeing `subPrs` come back, consumed
  // the one-shot resolution. `open` with no PR number or no branch is not a delivery.
  for (const over of [{ status: 'open', pr: null }, { status: 'open', branch: null }]) {
    const { result } = await run('issue-multi-pr.js', {
      args: multiArgs({
        subPrs: [{ id: 'a', status: 'pending', dependsOn: [], blocker: 'which shape?' }],
        blockerResolutions: [{ for: 'a', answer: 'key on tenant + scope' }],
      }),
      respond: multiResponder({ build: { a: over } }),
    })
    assert.equal(result.subPrs[0].blocker, 'which shape?', `handleless open (${JSON.stringify(over)}) delivered nothing`)
    assert.equal(result.subPrs[0].status, 'pending', 'and it stays pending for the retry')
  }

  // A complete open build IS a delivery and spends it.
  const complete = await run('issue-multi-pr.js', {
    args: multiArgs({
      subPrs: [{ id: 'a', status: 'pending', dependsOn: [], blocker: 'which shape?' }],
      blockerResolutions: [{ for: 'a', answer: 'key on tenant + scope' }],
    }),
    respond: multiResponder(),
  })
  assert.equal(complete.result.subPrs[0].blocker, null)
  assert.equal(complete.result.subPrs[0].status, 'open')
})

check('an answered PENDING slice keeps its blocker when the build fails', async () => {
  // The sibling of the failed-resume rule. An answered pending slice is delivered by a BUILD, so
  // restricting preservation to `resume` meant a schema-valid `failed`/`pending` cleared the blocker
  // while the caller consumed the one-shot answer — and the next build retried the fork blind.
  for (const status of ['failed', 'pending']) {
    const { result } = await run('issue-multi-pr.js', {
      args: multiArgs({
        subPrs: [{ id: 'a', status: 'pending', dependsOn: [], blocker: 'which shape?' }],
        blockerResolutions: [{ for: 'a', answer: 'key on tenant + scope' }],
      }),
      respond: multiResponder({ build: { a: { status } } }),
    })
    assert.equal(result.subPrs[0].blocker, 'which shape?', `a ${status} build delivered nothing`)
  }

  // An ordinary unblocked build that fails carries no blocker to preserve, so the rule costs nothing.
  const plain = await run('issue-multi-pr.js', {
    args: multiArgs({ subPrs: [{ id: 'a', status: 'pending', dependsOn: [] }] }),
    respond: multiResponder({ build: { a: { status: 'failed' } } }),
  })
  assert.equal(plain.result.subPrs[0].blocker, null)
})

check('a rebase is told to check out the branch it is rebasing', async () => {
  // The same re-entry the resume path needs, and the consequence here is worse: a reported success clears
  // `stackedOn`, so a rebase that moved whatever the worktree inherited leaves nothing to retry.
  const { calls } = await run('issue-multi-pr.js', {
    args: multiArgs({
      subPrs: [
        { id: 'a', status: 'merged', pr: 41, branch: 'fix/a', dependsOn: [] },
        { id: 'b', status: 'open', pr: 42, branch: 'fix/b', dependsOn: ['a'], stackedOn: 'fix/a' },
      ],
    }),
    respond: multiResponder(),
  })
  const rebase = calls.find((c) => c.label === 'rebase:b')
  assert.ok(rebase)
  assert.match(rebase.prompt, /Fetch and check out fix\/b first/)
  assert.match(rebase.prompt, /NOT on this sub-PR/)
  // The BASE needs its own fetch: the shared worktree's remote-tracking copy can predate the very merge
  // that triggered the rebase, and rebasing onto a stale ref drops it while still reporting success.
  assert.match(rebase.prompt, /Fetch origin\/main explicitly as well/)
})

check('unconsumable PR activity withholds every merge gate on the row', async () => {
  // `pendingAction` refuses the feedback worker when a scan reports activity it cannot timestamp — the
  // cursor cannot advance, so handling it would re-handle it every wake. The merge gate was independent
  // of that, so the human merged, the row went terminal, and that feedback was never handled by anyone.
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9 }),
        row('FIX-3', {
          phase: 'PR_FEEDBACK',
          subPrs: [{ id: 'a', status: 'open', pr: 41, branch: 'fix/a' }],
          assembledGoal: { passed: false, fixIssue: 'FIX-8', fixPr: 55, owningSubPr: 'a' },
        }),
      ],
    }),
    respond: epicResponder({
      fresh: {
        'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9, readyToMerge: true, newPrEvents: true, latestActivityAt: null },
        'FIX-3': {
          phase: 'PR_FEEDBACK',
          readyToMerge: false,
          newPrEvents: true,
          latestActivityAt: null,
          repairReadyToMerge: true,
          subPrStates: [{ id: 'a', merged: false, readyToMerge: true }],
        },
      },
    }),
  })
  assert.deepEqual(result.gates.filter((g) => g.kind === 'merge'), [], 'the row-level, sub-PR and repair gates all withhold')
  assert.deepEqual(workerLabels(calls), [], 'and nothing was dispatched to consume it either')

  // The SAME readiness with no unreadable activity is offered, which is what makes the case above about
  // the unconsumable scan rather than about readiness. (A usable cursor is not the contrast to reach for:
  // it dispatches the feedback worker, and a worker that ran voids the pre-worker readiness anyway.)
  const { result: quiet } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9 })] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9, readyToMerge: true, newPrEvents: false, latestActivityAt: null } },
    }),
  })
  assert.deepEqual(quiet.gates.filter((g) => g.kind === 'merge').map((g) => g.pr), [9])
})

check('GATE: a worker cannot jump a row across the approval gate', async () => {
  // `approvalGatedPhase` only corrected a row SITTING at NEEDS_IMPLEMENTATION unapproved. A worker
  // reporting PR_FEEDBACK with an implPr straight from NEEDS_SPEC skipped the gate entirely and reached a
  // merge gate with no human sign-off — the one gate that must never be bypassable, bypassed by a
  // self-report.
  for (const from of ['NEEDS_SPEC', 'AWAITING_SPEC_APPROVAL']) {
    for (const to of ['NEEDS_IMPLEMENTATION', 'PR_FEEDBACK', 'DONE']) {
      const { result } = await run('epic-wake.js', {
        args: epicArgs({ issues: [row('FIX-2', { phase: from, specPr: from === 'NEEDS_SPEC' ? null : 8 })] }),
        respond: epicResponder({
          fresh: { 'FIX-2': { phase: from, specPr: from === 'NEEDS_SPEC' ? null : 8 } },
          worker: { 'FIX-2': { phase: to, implPr: 9, readyToMerge: true } },
        }),
      })
      assert.equal(result.issues[0].phase, from, `${from} → ${to} is refused without an approval`)
      assert.deepEqual(result.gates.filter((g) => g.kind === 'merge'), [], 'and no merge gate follows it')
    }
  }

  // An APPROVED row makes the same jump legitimately — that is the documented chain-through.
  const approved = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 })] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8, specApproved: true, headSha: 'abc' } },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9 } },
    }),
  })
  assert.equal(approved.result.issues[0].phase, 'PR_FEEDBACK', 'an approved spec chains straight through')

  // And a row ALREADY implementing is untouched, even though a closed spec PR means no scan can still
  // report `specApproved` — gating on that flag rather than on the transition would strand all real work.
  const implementing = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9 })] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9, ciFailed: true } },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9 } },
    }),
  })
  assert.equal(implementing.result.issues[0].phase, 'PR_FEEDBACK')
})

check('a PR closed without merging parks the row on a human decision', async () => {
  // The scout reads PR metadata but could only express merged / ready / not-ready, so a closed-unmerged
  // handle left a single-PR row idle in PR_FEEDBACK forever and a slice durably `open`, which the DAG
  // cannot advance either.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9 })] }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9, closedUnmerged: true } } }),
  })
  assert.match(result.issues[0].blocker || '', /Closed without merging: impl PR #9/)
  assert.ok(
    result.blockers.some((b) => b.issueId === 'FIX-2'),
    'and it is surfaced to the human rather than idling',
  )

  // Per-slice too.
  const slice = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'PR_FEEDBACK', subPrs: [{ id: 'a', status: 'open', pr: 41, branch: 'fix/a' }] })],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', subPrStates: [{ id: 'a', merged: false, readyToMerge: false, closedUnmerged: true }] } },
    }),
  })
  assert.match(slice.result.issues[0].blocker || '', /Closed without merging: sub-PR a \(#41\)/)
})

check('the Linear refresh covers carried members, not just parent children', async () => {
  // orchestration.md keeps an existing functional parent and links such a member with relates-to, so it is
  // never in the parent→children set. Omitting it froze its Linear state at whatever was cached: a blocked
  // member never noticed its prerequisite merge, and a cancelled one kept being dispatched.
  const { calls } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'NEEDS_SPEC' }), row('FIX-7', { phase: 'NEEDS_SPEC' })] }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'NEEDS_SPEC' }, 'FIX-7': { phase: 'NEEDS_SPEC' } } }),
  })
  const linear = calls.find((c) => c.label === 'linear:epic-children')
  assert.match(linear.prompt, /FIX-2, FIX-7/, 'the carried ids are asked for by name')
  assert.match(linear.prompt, /relates-to/, 'and the reason is stated, so the scout does not treat it as redundant')
})

check('the repair worker bases its fix on fresh origin/main', async () => {
  // A fresh worktree starts on the lifecycle checkout, which drifts as slices merge — basing the repair
  // there puts unrelated commits in the fix PR or omits the merged slices whose interaction is failing.
  const { calls } = await run('issue-multi-pr.js', {
    args: multiArgs({
      subPrs: [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a', dependsOn: [] }],
      assembledGoal: { passed: false, failure: 'slices disagree', evidence: 'ran it', fixIssue: 'FIX-9', owningSubPr: 'a' },
    }),
    respond: multiResponder(),
  })
  const fix = calls.find((c) => (c.label || '').startsWith('assembled-fix'))
  assert.ok(fix)
  assert.match(fix.prompt, /branch from FRESH origin\/main first/)
})

check('an INCONCLUSIVE verdict is never folded as resolved', async () => {
  // `nextRow` turns an INCONCLUSIVE verdict into a human decision only AFTER the worker returns, so
  // telling that worker to fold every verdict had it write "resolved with evidence" into the spec and the
  // thread for a question nobody had answered — false evidence, in artifacts a later reader trusts.
  const { calls } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          implPr: 9,
          verdicts: [
            { claim: 'SSE resumes', verdict: 'INCONCLUSIVE', evidence: 'could not reproduce either way' },
            { claim: 'the store replays', verdict: 'CONFIRMED', evidence: 'ran it' },
          ],
        }),
      ],
    }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9 } } }),
  })
  const prompt = calls.find((c) => c.label === 'apply-verdict:FIX-2').prompt
  assert.match(prompt, /resolved-with-evidence[\s\S]*the store replays/, 'the settled claim is folded')
  assert.doesNotMatch(
    prompt.slice(0, prompt.indexOf('INCONCLUSIVE on')),
    /SSE resumes/,
    'the unsettled claim is not in the fold-and-record list',
  )
  assert.match(prompt, /Do NOT record these as resolved[\s\S]*SSE resumes/, 'it is handed over as an open question')

  // The epic-level fold has the same ordering, so it gets the same split.
  const epicSide = await run('epic-wake.js', {
    args: epicArgs({
      epic: {
        issueId: 'FIX-1',
        name: 'thing',
        branch: 'epic/thing',
        prNumber: 100,
        verdicts: [{ claim: 'one store per scope', verdict: 'INCONCLUSIVE', evidence: 'inconclusive under load' }],
      },
      issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 })],
    }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 } } }),
  })
  const foldPrompt = epicSide.calls.find((c) => c.label === 'fold:epic').prompt
  assert.doesNotMatch(foldPrompt, /Fold them FIRST/, 'nothing settled, so nothing is written in as a decision')
  assert.match(foldPrompt, /do NOT write a decision[\s\S]*one store per scope/)
})

check('an answered decision on a completed issue is still applied', async () => {
  // An INCONCLUSIVE late verdict leaves `verdicts` when it becomes a blocker, so once the human answers
  // there is no verdict left for the terminal branch to match — it parked the row and the epic wrapped
  // without the answer reaching the completed spec or its thread.
  const { calls } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'DONE', merged: true, implPr: 9, blockerResolutions: [{ for: null, answer: 'key on tenant + scope' }] })],
    }),
    respond: (prompt, opts) => {
      const label = opts.label || ''
      if (label === 'gate:epic') return { approved: true, approvedByLabel: false, approver: 'jake', headSha: 'abc', newReviewEvents: false, latestActivityAt: null }
      if (label === 'linear:epic-children') return { issues: [{ id: 'FIX-2', state: 'Done', blockedBy: [] }] }
      if (label.startsWith('refresh:')) return { issueId: 'FIX-2', ...freshRow({ phase: 'DONE', merged: true, implPr: 9 }) }
      return workerRes({ issueId: 'FIX-2', phase: 'DONE' })
    },
  })
  assert.deepEqual(workerLabels(calls), ['apply-decision:FIX-2'], 'the decision reaches the completed artifact')
  assert.match(calls.find((c) => c.label === 'apply-decision:FIX-2').prompt, /key on tenant \+ scope/)

  // CANCELLED work is the deliberate exception, same as for a landed verdict: there is no artifact left
  // to record the decision in, so the row parks rather than dispatching into nothing.
  const cancelled = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9, blockerResolutions: [{ for: null, answer: 'key on tenant + scope' }] })],
    }),
    respond: (prompt, opts) => {
      const label = opts.label || ''
      if (label === 'gate:epic') return { approved: true, approvedByLabel: false, approver: 'jake', headSha: 'abc', newReviewEvents: false, latestActivityAt: null }
      if (label === 'linear:epic-children') return { issues: [{ id: 'FIX-2', state: 'Canceled', blockedBy: [] }] }
      if (label.startsWith('refresh:')) return { issueId: 'FIX-2', ...freshRow({ phase: 'PR_FEEDBACK', implPr: 9 }) }
      return workerRes({ issueId: 'FIX-2' })
    },
  })
  assert.deepEqual(workerLabels(cancelled.calls), [], 'cancelled work applies nothing')
})

check('a worker cannot add a slice as merged, or open one without handles', async () => {
  // Two holes around the same guard. `merged` is unassertable for a NEW slice — no `prev` for the
  // transition guard to compare against — and a fabricated one immediately satisfies `allMerged`, so the
  // issue reaches DONE with a slice that never had a PR or passed the human merge gate. And `open` needed
  // both handles for a CARRIED slice too: the one transition a worker owns (pending → open) could land a
  // slice with no PR and no branch, which nothing can refresh, gate, or advance.
  const table = (subPrs) =>
    run('epic-wake.js', {
      args: epicArgs({
        issues: [
          row('FIX-2', {
            phase: 'PR_FEEDBACK',
            subPrs: [
              { id: 'a', status: 'merged', pr: 41, branch: 'fix/a' },
              { id: 'b', status: 'pending', dependsOn: [] },
            ],
            assembledGoal: { passed: false },
            multiPrPending: true,
          }),
        ],
      }),
      respond: epicResponder({
        fresh: {
          'FIX-2': {
            phase: 'PR_FEEDBACK',
            subPrStates: [
              { id: 'a', merged: true, readyToMerge: false },
              { id: 'b', merged: false, readyToMerge: false },
            ],
          },
        },
        worker: { 'FIX-2': { phase: 'PR_FEEDBACK', multiPrPending: true, subPrs } },
      }),
    })

  // A NEW slice claimed as merged.
  const asMerged = await table([
    { id: 'a', status: 'merged', pr: 41, branch: 'fix/a' },
    { id: 'b', status: 'pending' },
    { id: 'c', status: 'merged' },
  ])
  const c = asMerged.result.issues[0].subPrs.find((sp) => sp.id === 'c')
  assert.equal(c.status, 'pending', 'only the scan observes a merge')
  // ...while the merge the scan DID observe survives the worker echoing it. Refusing every reported
  // `merged` would demote `a` and the next wake would rebuild a slice that has already landed.
  assert.equal(asMerged.result.issues[0].subPrs.find((sp) => sp.id === 'a').status, 'merged')
  assert.notEqual(asMerged.result.issues[0].phase, 'DONE', 'so a fabricated merge cannot complete the issue')

  // A CARRIED pending slice promoted to open with no handles.
  const promoted = await table([
    { id: 'a', status: 'merged', pr: 41, branch: 'fix/a' },
    { id: 'b', status: 'open' },
  ])
  assert.equal(promoted.result.issues[0].subPrs.find((sp) => sp.id === 'b').status, 'pending', 'held for the build')

  // The same promotion WITH handles is the transition a worker owns.
  const opened = await table([
    { id: 'a', status: 'merged', pr: 41, branch: 'fix/a' },
    { id: 'b', status: 'open', pr: 42, branch: 'fix/b' },
  ])
  assert.equal(opened.result.issues[0].subPrs.find((sp) => sp.id === 'b').status, 'open')
})

check('a reopened PR clears its closed-handle blocker', async () => {
  // The blocker text advertises reopening on GitHub as a recovery needing no answer — and nothing cleared
  // the blocker when the scan stopped reporting the handle closed, so the advertised path parked the row
  // forever. The blocker is a scan observation, and it goes when the observation does.
  const closed = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9 })] }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9, closedUnmerged: true } } }),
  })
  assert.match(closed.result.issues[0].blocker || '', /Closed without merging/)
  assert.equal(closed.result.issues[0].closedBlocker, true, 'tagged, so the next wake can tell it apart')

  // Reopened: the scan no longer reports it closed, so the row resumes.
  const reopened = await run('epic-wake.js', {
    args: epicArgs({ issues: [{ ...closed.result.issues[0] }] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9, ciFailed: true } },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9 } },
    }),
  })
  assert.equal(reopened.result.issues[0].blocker, null, 'the observation is gone, so the blocker is too')
  assert.deepEqual(workerLabels(reopened.calls), ['pr-feedback:FIX-2'], 'and the row is working again')

  // A WORKER-raised blocker is not scan-derived and must survive — it is a real escalation.
  const escalated = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9, blocker: 'which shape?' })] }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9 } } }),
  })
  assert.equal(escalated.result.issues[0].blocker, 'which shape?', 'untagged blockers are nobody else to clear')
})

check('late spec-PR feedback is routed instead of merged over', async () => {
  // Comments can land on a retained or closed spec PR after the row has moved on. With no CI failure the
  // row could take a merge gate over an unread comment; with one, the feedback worker consumed the shared
  // cursor and cleared BOTH flags without being told to read it.
  const { calls, result } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9, specPr: 8 })] }),
    respond: epicResponder({
      fresh: {
        'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9, specPr: 8, newSpecReviewEvents: true, latestActivityAt: 'new', readyToMerge: true },
      },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9, specPr: 8 } },
    }),
  })
  assert.deepEqual(workerLabels(calls), ['pr-feedback:FIX-2'], 'the comment is read')
  const prompt = calls.find((c) => c.label === 'pr-feedback:FIX-2').prompt
  assert.match(prompt, /on its SPEC PR #8/)
  assert.match(prompt, /implementer notes/)
  assert.match(prompt, /do not spend a spec review round/)
  assert.deepEqual(result.gates.filter((g) => g.kind === 'merge'), [], 'and not merged out from under it')

  // Unreadable spec activity withholds the gate too, the same as unreadable impl activity.
  const unreadable = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9, specPr: 8 })] }),
    respond: epicResponder({
      fresh: {
        'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9, specPr: 8, newSpecReviewEvents: true, latestActivityAt: null, readyToMerge: true },
      },
    }),
  })
  assert.deepEqual(unreadable.result.gates.filter((g) => g.kind === 'merge'), [])
  assert.deepEqual(workerLabels(unreadable.calls), [], 'and nothing consumes what it cannot record')
})

check('a verdict parked behind a blocker does not spin the wake', async () => {
  // `moreWorkNow` counted a verdict as work by inspecting state. `pendingAction` refuses to dispatch a
  // parked row, so the immediate-continuation loop it asked for had no exit — a refresh every wake, forever,
  // instead of ending the turn for the human answer the blocker is waiting on.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          implPr: 9,
          blocker: 'which shape?',
          verdicts: [{ claim: 'c', verdict: 'CONFIRMED', evidence: 'ran it' }],
        }),
      ],
    }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9 } } }),
  })
  assert.equal(result.moreWorkNow, false, 'a parked row is not runnable work')
  assert.equal(result.issues[0].verdicts.length, 1, 'while the verdict itself is retained for after the answer')

  // Unparked, the same verdict IS work.
  const unparked = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9, verdicts: [{ claim: 'c', verdict: 'CONFIRMED', evidence: 'ran it' }] })] }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9 } }, nulls: ['apply-verdict:FIX-2'] }),
  })
  assert.equal(unparked.result.moreWorkNow, true)
})

check('a handled CI failure does not ask for an immediate wake', async () => {
  // `ciFailed` is scan-derived and NOT cleared when a worker handles it, so the returned row still reads as
  // failing. Treating any dispatchable row as runnable work therefore asked for a wake every wake while CI
  // was red — CI re-running is an external event, and waiting for it is the whole point.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9 })] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9, ciFailed: true } },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9 } },
    }),
  })
  assert.equal(result.issues[0].ciFailed, true, 'the flag survives, as only a fresh scan can clear it')
  assert.equal(result.moreWorkNow, false, 'so the turn ends and waits for the CI run')

  // A returned DAG step that reported more work DOES ask, since nothing external gates it.
  const dag = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'PR_FEEDBACK', subPrs: [{ id: 'a', status: 'pending', dependsOn: [] }], multiPrPending: true })],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', subPrStates: [{ id: 'a', merged: false, readyToMerge: false }] } },
      worker: {
        'FIX-2': { phase: 'PR_FEEDBACK', multiPrPending: true, subPrs: [{ id: 'a', status: 'open', pr: 41, branch: 'fix/a' }] },
      },
    }),
  })
  assert.equal(dag.result.moreWorkNow, true)
})

check("a cancelled row's open question is dropped, out loud", async () => {
  // `pendingAction` already refuses to dispatch cancelled work, so a blocker left on the row could never be
  // cleared by anything — and it kept the surfaced blockers list non-empty, holding the whole epic short of
  // wrap while a human was asked about work that no longer exists.
  const { result, logs } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          implPr: 9,
          blocker: 'which shape?',
          unsettled: [{ claim: 'SSE resumes', evidence: 'inconclusive', threads: null }],
        }),
      ],
    }),
    respond: (prompt, opts) => {
      const label = opts.label || ''
      if (label === 'gate:epic') return { approved: true, approvedByLabel: false, approver: 'jake', headSha: 'abc', newReviewEvents: false, latestActivityAt: null }
      if (label === 'linear:epic-children') return { issues: [{ id: 'FIX-2', state: 'Canceled', blockedBy: [] }] }
      if (label.startsWith('refresh:')) return { issueId: 'FIX-2', ...freshRow({ phase: 'PR_FEEDBACK', implPr: 9 }) }
      return workerRes({ issueId: 'FIX-2' })
    },
  })
  assert.equal(result.issues[0].blocker, null, 'the question goes with the work')
  assert.deepEqual(result.issues[0].unsettled, [])
  assert.deepEqual(result.blockers, [], 'so nothing is surfaced about a cancelled issue')
  assert.equal(result.mayWrap, true, 'and the epic can finish')
  assert.ok(
    (logs || []).some((l) => /cancelled with an open question/.test(l)),
    'dropped out loud, never silently',
  )

  // A LIVE row keeps its blocker — that is what makes the above about cancellation.
  const live = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9, blocker: 'which shape?' })] }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9 } } }),
  })
  assert.equal(live.result.issues[0].blocker, 'which shape?')
  assert.equal(live.result.mayWrap, false)
})

check('an externally blocked repair gap is a wait, not internal work', async () => {
  // A `blockedGap` recheck waits on an open Linear relation, which is external by definition. Reporting
  // pending DAG work for it asked for an immediate wake that rechecks an unchanged relation and burns a
  // slot in the shared cap, every wake, until someone else moves it.
  const { calls } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          subPrs: [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a' }],
          assembledGoal: { passed: false, failure: 'x', fixIssue: 'FIX-9', fixReady: false },
          multiPrPending: true,
        }),
      ],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', subPrStates: [{ id: 'a', merged: true, readyToMerge: false }] } },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', multiPrPending: true } },
    }),
  })
  const dispatch = calls.find((c) => (c.label || '').startsWith('implement:'))
  assert.ok(dispatch)
  assert.match(dispatch.prompt, /report multiPrPending FALSE when the workflow returns `blockedGap`/)
  assert.match(dispatch.prompt, /burns a slot in the shared cap/)
})

check('a cancelled row does not strand the epic short of wrap', async () => {
  // Cancelled work carries verdict state nothing can ever apply: `pendingAction` treats it as gone, so no
  // worker and no gate can clear it, and counting it as outstanding held the epic open permanently.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9, verdicts: [{ claim: 'c', verdict: 'CONFIRMED', evidence: 'ran it' }] })],
    }),
    respond: (prompt, opts) => {
      const label = opts.label || ''
      if (label === 'gate:epic') return { approved: true, approvedByLabel: false, approver: 'jake', headSha: 'abc', newReviewEvents: false, latestActivityAt: null }
      if (label === 'linear:epic-children') return { issues: [{ id: 'FIX-2', state: 'Canceled', blockedBy: [] }] }
      if (label.startsWith('refresh:')) return { issueId: 'FIX-2', ...freshRow({ phase: 'PR_FEEDBACK', implPr: 9 }) }
      return workerRes({ issueId: 'FIX-2' })
    },
  })
  assert.equal(result.mayWrap, true, 'the epic can finish')
  assert.equal(result.moreWorkNow, false, 'and nothing spins on it')
})

check('a carried epic verdict blocks wrap', async () => {
  // An epic-level verdict has no issue row to land on, so if its fold loses the cap to a terminal row's
  // worker the epic can look entirely finished while a cross-cutting decision is still unrecorded.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      epic: {
        issueId: 'FIX-1',
        name: 'thing',
        branch: 'epic/thing',
        prNumber: 100,
        verdicts: [{ claim: 'one store per scope', verdict: 'CONFIRMED', evidence: 'ran it' }],
      },
      issues: [row('FIX-2', { phase: 'DONE', merged: true, implPr: 9 })],
    }),
    respond: (prompt, opts) => {
      const label = opts.label || ''
      if (label === 'gate:epic') return { approved: true, approvedByLabel: false, approver: 'jake', headSha: 'abc', newReviewEvents: false, latestActivityAt: null }
      if (label === 'linear:epic-children') return { issues: [{ id: 'FIX-2', state: 'Done', blockedBy: [] }] }
      if (label.startsWith('refresh:')) return { issueId: 'FIX-2', ...freshRow({ phase: 'DONE', merged: true, implPr: 9 }) }
      if (label === 'fold:epic') return null // the fold died, so the verdict is still carried
      return workerRes({ issueId: 'FIX-2', phase: 'DONE' })
    },
  })
  assert.equal(result.epic.verdicts.length, 1, 'still owed')
  assert.equal(result.mayWrap, false, 'so the epic surface stays open')
})

check('a fold the cap squeezed out asks for another wake', async () => {
  // `foldEpicWanted && !plan.foldEpic` needs no external event — it lost a slot, nothing more.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      cap: 1,
      epic: { issueId: 'FIX-1', name: 'thing', branch: 'epic/thing', prNumber: 100, verdicts: [{ claim: 'c', verdict: 'CONFIRMED', evidence: 'e' }] },
      // A `pr-feedback` row, deliberately: a spec-authoring row would be HELD for the fold, and
      // `heldForFold` already implies another wake — which masked whether the capped-out fold does.
      issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9 })],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9, ciFailed: true } },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9 } },
    }),
  })
  assert.equal(result.moreWorkNow, true, 'the fold is runnable now, it just had no slot')
  assert.deepEqual(result.deferred, [], 'and nothing else in the wake is asking for one')
  assert.deepEqual(result.settleRequests, [])
  assert.deepEqual(result.heldForFold, [])
  assert.deepEqual(
    result.issues.filter((r) => r.verdicts && r.verdicts.length).map((r) => r.id),
    [],
  )
  assert.equal(result.dispatched.includes('fold:epic'), false, 'the fold did not run')
})

check('an unfolded verdict withholds every merge gate', async () => {
  // Settle runs after Advance, so a REFUTED or INCONCLUSIVE verdict lands in the same wake a refresh may
  // have marked the PR ready — merging then locks in an implementation the evidence just contradicted.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9 })],
      settleRequests: [{ claim: 'SSE resumes', load: 'x', falsify: 'y', issueId: 'FIX-2' }],
    }),
    respond: epicResponder({
      poc: { claim: 'SSE resumes', verdict: 'REFUTED', evidence: 'it does not' },
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9, readyToMerge: true } },
    }),
  })
  assert.deepEqual(result.gates.filter((g) => g.kind === 'merge'), [], 'not merged on a refuted premise')
  assert.equal(result.issues[0].verdicts.length, 1, 'the verdict is still owed a fold')
})

check('an approval batch with an unreadable cursor holds', async () => {
  // This is the ONLY pass that reads spec-PR feedback, so dispatching with a cursor that cannot advance
  // carried the batch once and then rediscovered it on every later timestamp-less scan.
  const { calls } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 })] }),
    respond: epicResponder({
      fresh: {
        'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8, specApproved: true, headSha: 'abc', newSpecReviewEvents: true, latestActivityAt: null },
      },
    }),
  })
  assert.deepEqual(workerLabels(calls), [], 'held until the scan can timestamp what it saw')

  // With a timestamp the approval releases, carrying the batch as implementer notes.
  const readable = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 })] }),
    respond: epicResponder({
      fresh: {
        'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8, specApproved: true, headSha: 'abc', newSpecReviewEvents: true, latestActivityAt: 'new' },
      },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9 } },
    }),
  })
  assert.deepEqual(workerLabels(readable.calls), ['implement:FIX-2'])
})

check('a zero-round fold preserves the legacy epic authorization', async () => {
  // The budget check normalizes `above_bar_found`; preserving only the camelCase field here persisted a
  // resumed epic as unauthorized the moment any zero-round fold ran.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      epic: {
        issueId: 'FIX-1',
        name: 'thing',
        branch: 'epic/thing',
        prNumber: 100,
        epic_review_rounds: 2,
        above_bar_found: true,
        verdicts: [{ claim: 'c', verdict: 'CONFIRMED', evidence: 'e' }],
      },
      issues: [row('FIX-2', { phase: 'NEEDS_SPEC' })],
    }),
    respond: epicResponder({
      fold: { roundsSpent: 0, aboveBar: false, folded: 'recorded the settled claim', fanOut: [] },
      fresh: { 'FIX-2': { phase: 'NEEDS_SPEC' } },
    }),
  })
  assert.equal(result.epic.aboveBarFound, true, 'the authorization survives a fold that spent no round')
})

check('an epic with an unanswered question may not wrap', async () => {
  // Wrap closes the epic surface and stops the wakes, so wrapping over an open question destroys it. Every
  // row terminal was the whole condition, and a late INCONCLUSIVE verdict on an already-merged issue is
  // exactly the state it misses: every row done, one question outstanding.
  const doneRow = (over) => row('FIX-2', { phase: 'DONE', merged: true, implPr: 9, ...over })
  const terminalRun = (over) =>
    run('epic-wake.js', {
      args: epicArgs({ issues: [doneRow(over)] }),
      respond: (prompt, opts) => {
        const label = opts.label || ''
        if (label === 'gate:epic') return { approved: true, approvedByLabel: false, approver: 'jake', headSha: 'abc', newReviewEvents: false, latestActivityAt: null }
        if (label === 'linear:epic-children') return { issues: [{ id: 'FIX-2', state: 'Done', blockedBy: [] }] }
        if (label.startsWith('refresh:')) return { issueId: 'FIX-2', ...freshRow({ phase: 'DONE', merged: true, implPr: 9 }) }
        return workerRes({ issueId: 'FIX-2', phase: 'DONE' })
      },
    })

  // EACH condition on its own. Setting several at once lets any one of them cover for a missing check —
  // the first version of this test set both a blocker and an unsettled record, and two separate mutations
  // survived because the other field still failed the assertion.
  const blockedOnly = await terminalRun({ blocker: 'POC returned INCONCLUSIVE — needs a human decision: SSE resumes' })
  assert.equal(blockedOnly.result.mayWrap, false, 'an unanswered blocker outlives the work')
  assert.ok(blockedOnly.result.blockers.some((b) => b.issueId === 'FIX-2'), 'and it is surfaced')

  const unsettledOnly = await terminalRun({ unsettled: [{ claim: 'SSE resumes', evidence: 'inconclusive', threads: null }] })
  assert.equal(unsettledOnly.result.mayWrap, false, 'an unsettled claim does too')

  // A verdict on a terminal row is FOLDED in the same wake, so it is outstanding only when that folding
  // worker died — which is exactly the state the wake must not wrap over.
  const verdictUnfolded = await run('epic-wake.js', {
    args: epicArgs({ issues: [doneRow({ verdicts: [{ claim: 'c', verdict: 'CONFIRMED', evidence: 'ran it' }] })] }),
    respond: (prompt, opts) => {
      const label = opts.label || ''
      if (label === 'gate:epic') return { approved: true, approvedByLabel: false, approver: 'jake', headSha: 'abc', newReviewEvents: false, latestActivityAt: null }
      if (label === 'linear:epic-children') return { issues: [{ id: 'FIX-2', state: 'Done', blockedBy: [] }] }
      if (label.startsWith('refresh:')) return { issueId: 'FIX-2', ...freshRow({ phase: 'DONE', merged: true, implPr: 9 }) }
      return null // the folding worker died, so the verdict is still owed
    },
  })
  assert.equal(verdictUnfolded.result.mayWrap, false, 'a verdict nobody folded is still outstanding')

  // ...and folded in the same wake, it is not outstanding at all — which is what makes the case above
  // about the dead worker rather than about verdicts existing.
  const verdictFolded = await terminalRun({ verdicts: [{ claim: 'c', verdict: 'CONFIRMED', evidence: 'ran it' }] })
  assert.equal(verdictFolded.result.mayWrap, true)

  // Drained: every row terminal and nothing outstanding.
  const clean = await terminalRun({})
  assert.equal(clean.result.mayWrap, true)
})

check('a verdict landing after Advance asks for another wake now', async () => {
  // Settle runs AFTER Advance, so a verdict it produces cannot be folded until a later wake. The
  // continuation rule listed fold-held rows, cap-deferred rows and queued claims — and missed this, so the
  // fold waited on the heartbeat and could lose the race to EPIC_WRAP on an already-merged issue.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 })],
      settleRequests: [{ claim: 'SSE resumes', load: 'x', falsify: 'y', issueId: 'FIX-2' }],
    }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 } } }),
  })
  assert.equal(result.verdicts.length, 1, 'the POC settled it this wake')
  assert.equal(result.moreWorkNow, true, 'so another wake runs now rather than waiting for an event')

  // A quiet wake asks for nothing.
  const quiet = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 })] }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 } } }),
  })
  assert.equal(quiet.result.moreWorkNow, false)
})

check('a dead or partial scan cannot clear a closed-handle blocker', async () => {
  // A dead scout leaves `fresh` empty and a partial multi-PR scan can omit the handle: in both cases "no
  // closed handle reported" is indistinguishable from "reopened", so clearing on absence released the row
  // on an observation nobody made and dispatched work against a handle that is still dead.
  const carried = row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9, closedBlocker: true, blocker: 'Closed without merging: impl PR #9. Needs a human decision' })

  const deadScout = await run('epic-wake.js', {
    args: epicArgs({ issues: [carried] }),
    respond: epicResponder({ nulls: ['refresh:FIX-2'] }),
  })
  assert.match(deadScout.result.issues[0].blocker || '', /Closed without merging/, 'a dead scout observed nothing')
  assert.equal(deadScout.result.issues[0].closedBlocker, true)

  // An affirmative live scan that no longer reports it closed DOES clear it.
  const live = await run('epic-wake.js', {
    args: epicArgs({ issues: [carried] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9, ciFailed: true } },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9 } },
    }),
  })
  assert.equal(live.result.issues[0].blocker, null, 'a live complete scan is an observation')
})

check('a scout cannot regress a row back across the gate either', async () => {
  // The mirror of the forward jump, and it costs duplicate work rather than a bypass: a carried PR_FEEDBACK
  // row reported as NEEDS_SPEC while its implementation PR is open makes the next wake dispatch `issue-spec`
  // and open a SECOND spec PR for work already under review. Re-gating is a decision; a scan reports facts.
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9 })] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'NEEDS_SPEC', implPr: 9 } },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9 } },
    }),
  })
  assert.equal(result.issues[0].phase, 'PR_FEEDBACK', 'the durable phase stands')
  assert.deepEqual(workerLabels(calls), [], 'and no duplicate spec is authored')

  // A multi-PR row is protected by its sub-PR table for the same reason.
  const dag = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'PR_FEEDBACK', subPrs: [{ id: 'a', status: 'open', pr: 41, branch: 'fix/a' }] })],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'NEEDS_SPEC', subPrStates: [{ id: 'a', merged: false, readyToMerge: false }] } },
    }),
  })
  assert.equal(dag.result.issues[0].phase, 'PR_FEEDBACK')

  // With NO durable handle there is nothing to protect, so the scan is believed — that is what makes the
  // rule about contradicting evidence rather than about refusing scans.
  const noHandle = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'PR_FEEDBACK' })] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'NEEDS_SPEC' } },
      worker: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 } },
    }),
  })
  assert.equal(noHandle.result.issues[0].phase, 'AWAITING_SPEC_APPROVAL')
})

check('the nested DAG workflow inherits the epic cap', async () => {
  // Omitting it leaves the nested workflow on its own default, so one outer worker can spawn that many
  // sub-PR worktrees beneath itself — and several outer rows multiply it, so the VM-sized cap stops meaning
  // anything.
  const { calls } = await run('epic-wake.js', {
    args: epicArgs({
      cap: 2,
      issues: [row('FIX-2', { phase: 'PR_FEEDBACK', subPrs: [{ id: 'a', status: 'pending', dependsOn: [] }], multiPrPending: true })],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', subPrStates: [{ id: 'a', merged: false, readyToMerge: false }] } },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', multiPrPending: false, subPrs: [{ id: 'a', status: 'open', pr: 41, branch: 'fix/a' }] } },
    }),
  })
  const dispatch = calls.find((c) => (c.label || '').startsWith('implement:'))
  assert.ok(dispatch)
  assert.match(dispatch.prompt, /`cap: 2`/, 'the epic cap travels into the nested step')
  assert.match(dispatch.prompt, /not optional/)
})

check('an acknowledgement describes one delivery, not the slice', async () => {
  // `...node` carried the previous value, so a second decision on the same slice inherited the first one's
  // acknowledgement — and if that second resume then failed, the stale marker told the caller the new answer
  // had landed, deleting a one-shot answer while the PR stayed as it was.
  const { result } = await run('issue-multi-pr.js', {
    args: multiArgs({
      subPrs: [{ id: 'a', status: 'open', pr: 41, branch: 'fix/a', dependsOn: [], blocker: 'which shape now?', answerApplied: true }],
      blockerResolutions: [{ for: 'a', answer: 'the second decision' }],
    }),
    respond: multiResponder({ build: { a: { status: 'failed' } } }),
  })
  assert.equal(result.subPrs[0].answerApplied, undefined, 'the stale acknowledgement does not carry over')
  assert.equal(result.subPrs[0].blocker, 'which shape now?', 'so the new answer is still owed')

  // The same lie by the other route, and the reason "set it explicitly" had to cover BOTH return paths: a
  // slice that isn't dispatched at all returns its carried row, stale acknowledgement included. Decision B
  // arrives, the cap spends its slot elsewhere, and A's acknowledgement tells the caller B was delivered —
  // so B's one-shot resolution is dropped and the unchanged PR becomes merge-eligible.
  const deferred = await run('issue-multi-pr.js', {
    args: multiArgs({
      cap: 1,
      subPrs: [
        { id: 'b', status: 'pending', dependsOn: [] },
        { id: 'a', status: 'open', pr: 41, branch: 'fix/a', dependsOn: [], blocker: 'which shape now?', answerApplied: true },
      ],
      blockerResolutions: [{ for: 'a', answer: 'the second decision' }],
    }),
    respond: multiResponder(),
  })
  assert.deepEqual(deferred.result.deferred, ['a'], 'the answered slice lost the cap slot')
  const held = deferred.result.subPrs.find((s) => s.id === 'a')
  assert.equal(held.answerApplied, undefined, 'so it must not claim the answer landed')
  assert.equal(held.blocker, 'which shape now?', 'and the decision is still owed')

  // OVER-CORRECTION: a resume that DID land still says so, or the caller re-asks a question already answered
  // and a second worker re-applies the same decision.
  const landed = await run('issue-multi-pr.js', {
    args: multiArgs({
      subPrs: [{ id: 'a', status: 'open', pr: 41, branch: 'fix/a', dependsOn: [], blocker: 'which shape now?' }],
      blockerResolutions: [{ for: 'a', answer: 'the second decision' }],
    }),
    respond: multiResponder(),
  })
  assert.equal(landed.result.subPrs[0].answerApplied, true)
})

check('GATE: a scout cannot jump a row across the approval gate either', async () => {
  // The worker's report was guarded; the refresh is an INDEPENDENT producer of `phase`, and a scan claiming
  // PR_FEEDBACK with an impl handle on a row still awaiting approval walked straight past it.
  for (const from of ['NEEDS_SPEC', 'AWAITING_SPEC_APPROVAL']) {
    const { result } = await run('epic-wake.js', {
      args: epicArgs({ issues: [row('FIX-2', { phase: from, specPr: from === 'NEEDS_SPEC' ? null : 8 })] }),
      respond: epicResponder({
        fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9, readyToMerge: true, specApproved: false } },
        worker: { 'FIX-2': { phase: from, specPr: from === 'NEEDS_SPEC' ? null : 8 } },
      }),
    })
    assert.equal(result.issues[0].phase, from, `a scan cannot move ${from} past the gate`)
    assert.deepEqual(result.gates.filter((g) => g.kind === 'merge'), [], 'and no merge gate follows')
  }

  // With the approval observed, the same scan is believed.
  const approved = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 })] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9, specApproved: true, headSha: 'abc' } },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9 } },
    }),
  })
  assert.equal(approved.result.issues[0].phase, 'PR_FEEDBACK')
})

check('a successful resume spends the answer, a failed one does not', async () => {
  // A resume works on an existing open PR, so success is `open → open` with no blocker — indistinguishable
  // from failure by status alone. Guessing success dropped the answer; guessing failure re-dispatched the
  // same resume every wake while the merge gate stayed withheld, so the slice could neither finish nor stop.
  const args = epicArgs({
    issues: [
      row('FIX-2', {
        phase: 'PR_FEEDBACK',
        blockerFor: 'a',
        blockerResolutions: [{ for: 'a', answer: 'key on tenant + scope' }],
        subPrs: [{ id: 'a', status: 'open', pr: 41, branch: 'fix/a' }],
        multiPrPending: true,
      }),
    ],
  })
  const fresh = { 'FIX-2': { phase: 'PR_FEEDBACK', subPrStates: [{ id: 'a', merged: false, readyToMerge: false }] } }

  const applied = await run('epic-wake.js', {
    args,
    respond: epicResponder({
      fresh,
      worker: {
        'FIX-2': {
          phase: 'PR_FEEDBACK',
          multiPrPending: false,
          subPrs: [{ id: 'a', status: 'open', pr: 41, branch: 'fix/a', answerApplied: true }],
        },
      },
    }),
  })
  assert.deepEqual(applied.result.issues[0].blockerResolutions, [], 'the nested workflow said it landed')

  const notApplied = await run('epic-wake.js', {
    args,
    respond: epicResponder({
      fresh,
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', multiPrPending: true, subPrs: [{ id: 'a', status: 'open', pr: 41, branch: 'fix/a' }] } },
    }),
  })
  assert.deepEqual(
    notApplied.result.issues[0].blockerResolutions,
    [{ for: 'a', answer: 'key on tenant + scope' }],
    'and without that acknowledgement it waits, rather than being guessed either way',
  )
})

check('the epic legacy third-round flag is dual-read', async () => {
  // The epic counter was dual-read while the flag AUTHORIZING its third round was not, so an epic resumed
  // from the previous instructions read two rounds with no authorization and skipped an allowed round.
  const { calls } = await run('epic-wake.js', {
    args: epicArgs({
      epic: { issueId: 'FIX-1', name: 'thing', branch: 'epic/thing', prNumber: 100, epic_review_rounds: 2, above_bar_found: true },
      issues: [row('FIX-2', { phase: 'NEEDS_SPEC' })],
    }),
    respond: epicResponder({ epicReviewEvents: true, fresh: { 'FIX-2': { phase: 'NEEDS_SPEC' } } }),
  })
  assert.ok(
    calls.some((c) => c.label === 'fold:epic'),
    'the authorized third epic round is dispatched',
  )
})

check('a CI failure also waits on unreadable SPEC activity', async () => {
  // The guard named only impl-PR activity. Once late spec-PR activity routed through the same worker and the
  // same shared cursor, an unreadable spec batch was re-delivered every wake alongside the CI work.
  const { calls } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9, specPr: 8 })] }),
    respond: epicResponder({
      fresh: {
        'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9, specPr: 8, ciFailed: true, newSpecReviewEvents: true, latestActivityAt: null },
      },
    }),
  })
  assert.deepEqual(workerLabels(calls), [], 'not dispatched while the spec batch cannot be recorded')
})

check('an untargeted answer reaches only the slice that asked', async () => {
  // A legacy single-slot answer carries no target. Treating it as "for the issue" handed it to every ready
  // node, so an unrelated pending slice was told to implement another slice's architectural decision.
  const { calls } = await run('issue-multi-pr.js', {
    args: multiArgs({
      subPrs: [
        { id: 'a', status: 'pending', dependsOn: [], blocker: 'which shape?' },
        { id: 'b', status: 'pending', dependsOn: [] },
      ],
      blockerResolution: 'key on tenant + scope',
    }),
    respond: multiResponder(),
  })
  const forA = calls.find((c) => c.label === 'build:a')
  const forB = calls.find((c) => c.label === 'build:b')
  assert.ok(forA && forB, 'both slices are dispatched')
  assert.match(forA.prompt, /key on tenant \+ scope/, 'the blocked slice gets the answer')
  assert.doesNotMatch(forB.prompt, /key on tenant \+ scope/, 'the unrelated slice does not')

  // AMBIGUOUS is the case naming the sole blocked slice did not cover, and the fallback there delivered to
  // everybody: two slices blocked, one untargeted answer, and BOTH were resumed to apply one human's choice
  // to two different forks. Ambiguity now resolves to nobody — one more ask, with its target named, against
  // an implementation committed to a decision nobody made on a PR that then becomes merge-eligible.
  const twoBlocked = await run('issue-multi-pr.js', {
    args: multiArgs({
      subPrs: [
        { id: 'a', status: 'open', pr: 41, branch: 'fix/a', dependsOn: [], blocker: 'which cache key?' },
        { id: 'b', status: 'open', pr: 42, branch: 'fix/b', dependsOn: [], blocker: 'which transport?' },
      ],
      blockerResolution: 'key on tenant + scope',
    }),
    respond: multiResponder(),
  })
  assert.deepEqual(twoBlocked.result.dispatched, [], 'neither fork is resumed on an answer that could be for either')
  assert.match(twoBlocked.logs.join('\n'), /refusing to guess which one it answers/)
  assert.deepEqual(
    twoBlocked.result.awaiting.decision.map((d) => d.id),
    ['a', 'b'],
    'and both questions go back to the human',
  )

  // The repair's fork is a target of the same kind, so an answer that could be for either releases neither.
  // `rowLevelAnswer` alone used to release the repair, sending a fix worker off with a slice's decision.
  const sliceAndRepair = await run('issue-multi-pr.js', {
    args: multiArgs({
      subPrs: [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a', dependsOn: [], blocker: 'which cache key?' }],
      assembledGoal: { passed: false, failure: 'boom', evidence: 'ran it', fixIssue: 'FIX-9', fixReady: true, owningSubPr: 'a', fixBlocker: 'which shape?' },
      blockerResolution: 'key on tenant + scope',
    }),
    respond: multiResponder(),
  })
  assert.deepEqual(
    sliceAndRepair.calls.filter((c) => (c.label || '').startsWith('assembled-fix')),
    [],
    'the repair is not released by an answer that may belong to the slice',
  )

  // ...and with NOTHING blocked it belongs to nothing here. This is the original contamination, still live
  // whenever the count was zero rather than one: the note went onto every build in the wake.
  const noneBlocked = await run('issue-multi-pr.js', {
    args: multiArgs({ subPrs: [{ id: 'a', status: 'pending', dependsOn: [] }], blockerResolution: 'key on tenant + scope' }),
    respond: multiResponder(),
  })
  assert.doesNotMatch(noneBlocked.calls.find((c) => c.label === 'build:a').prompt, /key on tenant \+ scope/)
  assert.match(noneBlocked.logs.join('\n'), /nothing here for it to answer/)
})

check('an answered closed handle is named to the worker, not auto-rebuilt', async () => {
  // The automatic rebuild is GONE. Resetting the slice, marking the dead handle, and refusing the worker's
  // echo of it needed a distinction the merge boundary does not have — the handle you were given versus the
  // handle you just created — and each guard for one broke the other. Detection stands (the row no longer
  // idles silently); recovery is the human's, carried out by a worker that is told which handle is dead.
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          closedBlocker: true,
          blockerResolutions: [{ for: 'a', answer: 'rebuild it' }],
          subPrs: [{ id: 'a', status: 'open', pr: 41, branch: 'fix/a' }],
          multiPrPending: true,
        }),
      ],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', subPrStates: [{ id: 'a', merged: false, readyToMerge: false, closedUnmerged: true }] } },
      worker: {
        'FIX-2': {
          phase: 'PR_FEEDBACK',
          multiPrPending: true,
          // The rebuild opened a REPLACEMENT PR. Nothing may discard it — the previous dead-handle guard
          // did exactly that, orphaning the new PR and rebuilding the slice again every wake.
          subPrs: [{ id: 'a', status: 'open', pr: 55, branch: 'fix/a-rebuild' }],
        },
      },
    }),
  })
  const a = result.issues[0].subPrs.find((sp) => sp.id === 'a')
  assert.equal(a.pr, 55, 'the replacement handle is persisted')
  assert.equal(a.branch, 'fix/a-rebuild')
  assert.equal(a.status, 'open')

  const dispatch = calls.find((c) => (c.label || '').startsWith('implement:'))
  assert.ok(dispatch, 'the answer reaches a worker')
  assert.match(dispatch.prompt, /CLOSED WITHOUT MERGING/, 'and the worker is told the handle is dead')
  assert.match(dispatch.prompt, /open a NEW PR for that slice/)
  assert.match(dispatch.prompt, /rebuild it/, 'alongside the human answer itself')
  // ...and told HOW, because the same prompt orders it to advance the DAG with `issue-multi-pr`, and the
  // table it serializes still carries the dead handle as `open` — which that workflow reads as a slice to
  // RESUME, the one instruction that forbids the replacement this answer asked for. Two contradictory
  // orders in one prompt, and the reachable outcome was the worse one: answer spent, nothing rebuilt, the
  // same question asked again next wake.
  assert.match(dispatch.prompt, /Pass that slice to issue-multi-pr as `status: "pending"`/)
  assert.match(dispatch.prompt, /forbid opening a replacement/)
  assert.match(dispatch.prompt, /with its dead `pr` and `branch` omitted/)

  // The repair PR is the third dead handle and it needs a different move: it lives outside `subPrs`, so
  // there is no slice to rebuild — clearing `fixPr` is what re-opens the repair against the gap already
  // filed. Left set, assembly reports AWAITING_FIX forever on a PR that can never merge.
  const deadRepair = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          closedBlocker: true,
          blockerResolutions: [{ answer: 'rebuild the repair' }],
          subPrs: [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a' }],
          assembledGoal: { failure: 'boom', evidence: 'fsdev run: FAIL', fixIssue: 'FIX-99', fixReady: true, fixPr: 42 },
        }),
      ],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', subPrStates: [{ id: 'a', merged: true, readyToMerge: false }], repairClosedUnmerged: true } },
    }),
  })
  const repair = deadRepair.calls.find((c) => /^(implement|pr-feedback|apply-decision):/.test(c.label || ''))
  assert.ok(repair, 'the answer about the repair handle reaches a worker')
  assert.match(repair.prompt, /pass `assembledGoal` with `fixPr: null`/)

  // OVER-CORRECTION: a single-PR row has no table to rewrite and never runs the nested workflow, so the
  // hand-over instruction would be an order pointing at machinery that isn't in play.
  const singlePr = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9, closedBlocker: true, blockerResolutions: [{ answer: 'rebuild it' }] })],
    }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9, closedUnmerged: true } } }),
  })
  const one = singlePr.calls.find((c) => /^(implement|pr-feedback|apply-decision):/.test(c.label || ''))
  assert.ok(one, 'the answer reaches a worker here too')
  assert.match(one.prompt, /CLOSED WITHOUT MERGING/)
  assert.doesNotMatch(one.prompt, /Pass that slice to issue-multi-pr/)
})

check('a repair PR closed without merging parks the row too', async () => {
  // Closed unmerged, `assembleState` stays at AWAITING_FIX, `multiPrHasWork` dispatches nothing and no
  // merge gate appears — the row idles indefinitely. The other two handles got this signal a round earlier.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          subPrs: [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a' }],
          assembledGoal: { passed: false, fixIssue: 'FIX-9', fixPr: 55, owningSubPr: 'a' },
        }),
      ],
    }),
    respond: epicResponder({
      fresh: {
        'FIX-2': {
          phase: 'PR_FEEDBACK',
          repairClosedUnmerged: true,
          subPrStates: [{ id: 'a', merged: true, readyToMerge: false }],
        },
      },
    }),
  })
  assert.match(result.issues[0].blocker || '', /Closed without merging: repair PR #55/)
  assert.ok(result.blockers.some((b) => b.issueId === 'FIX-2'))
})

check('a worker cannot add a slice that is open with no handles', async () => {
  // The status transition guard only runs when there IS a carried row, so a worker revising the PR plan
  // could insert `{ id, status: 'open' }` with no PR and no branch: no DAG action, no handle to refresh,
  // no merge gate able to name it.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'PR_FEEDBACK', subPrs: [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a' }], multiPrPending: true })],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', subPrStates: [{ id: 'a', merged: true, readyToMerge: false }] } },
      worker: {
        'FIX-2': {
          phase: 'PR_FEEDBACK',
          multiPrPending: true,
          subPrs: [
            { id: 'a', status: 'merged', pr: 41, branch: 'fix/a' },
            { id: 'b', status: 'open' },
          ],
        },
      },
    }),
  })
  const b = result.issues[0].subPrs.find((sp) => sp.id === 'b')
  assert.equal(b.status, 'pending', 'entered as pending so the next wake builds it')

  // A new slice WITH both handles is taken as open — the worker did open that PR.
  const complete = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'PR_FEEDBACK', subPrs: [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a' }], multiPrPending: true })],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', subPrStates: [{ id: 'a', merged: true, readyToMerge: false }] } },
      worker: {
        'FIX-2': {
          phase: 'PR_FEEDBACK',
          multiPrPending: true,
          subPrs: [
            { id: 'a', status: 'merged', pr: 41, branch: 'fix/a' },
            { id: 'b', status: 'open', pr: 42, branch: 'fix/b' },
          ],
        },
      },
    }),
  })
  assert.equal(complete.result.issues[0].subPrs.find((sp) => sp.id === 'b').status, 'open')
})

check('the one-wake merge trigger is consumed by the worker that ran', async () => {
  // Left set, a later wake whose refresh scout died carried it forward and dispatched another worker on a
  // merge already acted on, burning a slot in the shared cap every time the scout failed.
  const args = epicArgs({
    issues: [
      row('FIX-2', {
        phase: 'PR_FEEDBACK',
        subPrs: [
          { id: 'a', status: 'open', pr: 41, branch: 'fix/a' },
          { id: 'b', status: 'pending', dependsOn: ['a'] },
        ],
      }),
    ],
  })
  const fresh = {
    'FIX-2': {
      phase: 'PR_FEEDBACK',
      subPrStates: [
        { id: 'a', merged: true, readyToMerge: false },
        { id: 'b', merged: false, readyToMerge: false },
      ],
    },
  }
  const { result } = await run('epic-wake.js', {
    args,
    respond: epicResponder({
      fresh,
      worker: {
        'FIX-2': {
          phase: 'PR_FEEDBACK',
          multiPrPending: false,
          subPrs: [
            { id: 'a', status: 'merged', pr: 41, branch: 'fix/a' },
            { id: 'b', status: 'open', pr: 42, branch: 'fix/b' },
          ],
        },
      },
    }),
  })
  assert.equal(result.issues[0].subPrMergedThisWake, false, 'spent by the worker that acted on it')

  // A row the CAP DEFERRED ran no worker, so the trigger is still owed — that is the reachable state the
  // clearing has to skip. (A row whose worker DIED never reaches this code at all, so it cannot pin it.)
  const deferred = await run('epic-wake.js', {
    args: epicArgs({
      cap: 1,
      issues: [
        row('FIX-1x', { phase: 'NEEDS_SPEC' }),
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          subPrs: [
            { id: 'a', status: 'open', pr: 41, branch: 'fix/a' },
            { id: 'b', status: 'pending', dependsOn: ['a'] },
          ],
        }),
      ],
    }),
    respond: epicResponder({
      fresh: { 'FIX-1x': { phase: 'NEEDS_SPEC' }, ...fresh },
      worker: { 'FIX-1x': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 7 } },
    }),
  })
  const held = deferred.result.issues.find((r) => r.id === 'FIX-2')
  assert.ok(deferred.result.deferred.includes('FIX-2'), 'the cap deferred it')
  assert.equal(held.subPrMergedThisWake, true, 'no worker ran on it, so the merge is still unacted')
})

check('a repair answer survives a repair that opened nothing', async () => {
  // A repair answer is aimed at `assembledGoal.fixBlocker`, which by design has no row in `subPrs` — so
  // the "no such slice, drop it" rule discarded it, and the next wake retried the repair at the identical
  // fork with neither the blocker nor the answer.
  const args = (over = {}) =>
    epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          blockerResolutions: [{ for: null, answer: 'key on tenant + scope' }],
          subPrs: [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a' }],
          assembledGoal: { passed: false, failure: 'slices disagree', fixIssue: 'FIX-9', fixBlocker: 'which shape?', owningSubPr: 'a' },
          multiPrPending: true,
          ...over,
        }),
      ],
    })
  const fresh = { 'FIX-2': { phase: 'PR_FEEDBACK', subPrStates: [{ id: 'a', merged: true, readyToMerge: false }] } }

  // The repair worker returned, but opened nothing and raised no new question.
  const { result } = await run('epic-wake.js', {
    args: args(),
    respond: epicResponder({
      fresh,
      worker: {
        'FIX-2': {
          phase: 'PR_FEEDBACK',
          multiPrPending: true,
          subPrs: [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a' }],
          assembledGoal: { passed: false, failure: 'slices disagree', fixIssue: 'FIX-9', fixBlocker: 'which shape?', owningSubPr: 'a' },
        },
      },
    }),
  })
  assert.deepEqual(
    result.issues[0].blockerResolutions,
    [{ for: null, answer: 'key on tenant + scope' }],
    'nothing was delivered, so the answer waits for the attempt that lands',
  )

  // A repair that OPENED a fix PR spent it.
  const opened = await run('epic-wake.js', {
    args: args(),
    respond: epicResponder({
      fresh,
      worker: {
        'FIX-2': {
          phase: 'PR_FEEDBACK',
          multiPrPending: true,
          subPrs: [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a' }],
          assembledGoal: { passed: false, failure: 'slices disagree', fixIssue: 'FIX-9', fixPr: 55, owningSubPr: 'a' },
        },
      },
    }),
  })
  assert.deepEqual(opened.result.issues[0].blockerResolutions, [], 'the repair landed, so the answer is spent')

  // ...and so did one that came back with a DIFFERENT question.
  const reAsked = await run('epic-wake.js', {
    args: args(),
    respond: epicResponder({
      fresh,
      worker: {
        'FIX-2': {
          phase: 'PR_FEEDBACK',
          multiPrPending: true,
          subPrs: [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a' }],
          assembledGoal: { passed: false, failure: 'slices disagree', fixIssue: 'FIX-9', fixBlocker: 'tenant key collides — drop which?', owningSubPr: 'a' },
        },
      },
    }),
  })
  assert.deepEqual(
    reAsked.result.issues[0].blockerResolutions,
    [{ for: null, answer: 'key on tenant + scope' }],
    'a re-asked question keeps the answer too: the repair is still owed, and the wake that retries it needs it',
  )
})

check('a single-PR row applies an answered decision instead of parking', async () => {
  // The answered-work dispatch lived only inside `multiPrHasWork`. A single-PR row whose INCONCLUSIVE
  // verdict became a blocker had that blocker cleared and its answer queued with nothing to apply it,
  // while its gate could reappear for the unchanged artifact.
  const { calls, result } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8, blockerResolutions: [{ for: null, answer: 'use the store adapter' }] })],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 } },
      worker: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 } },
    }),
  })
  assert.deepEqual(workerLabels(calls), ['apply-decision:FIX-2'], 'the decision is applied, not parked')
  const prompt = calls.find((c) => c.label === 'apply-decision:FIX-2').prompt
  assert.match(prompt, /use the store adapter/, 'and the worker is handed the answer verbatim')
  assert.deepEqual(result.issues[0].blockerResolutions, [], 'spent by the worker that applied it')
  assert.deepEqual(
    result.gates.filter((g) => g.kind === 'spec-approval').map((g) => g.pr),
    [8],
    'and the gate follows in the same wake, because the decision reached the artifact',
  )

  // The guard bites where the decision is queued and NOT applied — a worker that died. Gates are derived
  // from the post-worker row, so this is the reachable state in which an unapplied answer is still on it.
  const died = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8, blockerResolutions: [{ for: null, answer: 'use the store adapter' }] })],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 } },
      nulls: ['apply-decision:FIX-2'],
    }),
  })
  assert.deepEqual(died.result.gates, [], 'nothing is signed off while the decision is still unapplied')
  assert.deepEqual(
    died.result.issues[0].blockerResolutions,
    [{ for: null, answer: 'use the store adapter' }],
    'and a dead worker spends nothing',
  )

  // The MERGE gate needs the same guard, and it is the one that cannot be taken back: a single-PR row
  // whose decision is unapplied must not be offered for merge.
  const mergeable = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9, blockerResolutions: [{ for: null, answer: 'use the store adapter' }] })],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9, readyToMerge: true } },
      nulls: ['apply-decision:FIX-2'],
    }),
  })
  assert.deepEqual(mergeable.result.gates.filter((g) => g.kind === 'merge'), [], 'not merged over an unapplied decision')

  // It is a FALLBACK: a row with real phase work does that work, and the prompt still carries the answer.
  const withWork = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9, blockerResolutions: [{ for: null, answer: 'use the store adapter' }] })],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9, ciFailed: true } },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9 } },
    }),
  })
  assert.deepEqual(workerLabels(withWork.calls), ['pr-feedback:FIX-2'], 'the phase wins')
  assert.match(withWork.calls.find((c) => c.label === 'pr-feedback:FIX-2').prompt, /use the store adapter/)
})

check('the legacy third-round authorization flag is dual-read', async () => {
  // The count was dual-read and the flag that AUTHORIZES the conditional third round was not, so an epic
  // resumed from the previous lifecycle instructions read 2 rounds with no authorization, declared
  // convergence, and skipped a round the rules allow.
  const { calls } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [{ id: 'FIX-2', phase: 'AWAITING_SPEC_APPROVAL', specPr: 8, spec_review_rounds: 2, spec_level_found: true }],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8, newSpecReviewEvents: true, latestActivityAt: 'new' } },
      worker: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8, specReviewRoundsSpent: 1 } },
    }),
  })
  assert.deepEqual(workerLabels(calls), ['spec-review:FIX-2'], 'the authorized third round is dispatched')

  // Without the legacy authorization it converges, which is what makes the above about the flag.
  const unauthorized = await run('epic-wake.js', {
    args: epicArgs({
      issues: [{ id: 'FIX-2', phase: 'AWAITING_SPEC_APPROVAL', specPr: 8, spec_review_rounds: 2, spec_level_found: false }],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8, newSpecReviewEvents: true, latestActivityAt: 'new' } },
    }),
  })
  assert.deepEqual(workerLabels(unauthorized.calls), [], 'converged')
})

check('a nested blocker gets its marker even when the worker mirrors it to the row', async () => {
  // The marker was derived only when the row-level mirror was ABSENT — but the schema invites both
  // channels, and returning both is the natural thing for a worker to do. With no `blockerFor` the
  // resolution pass cannot clear the right nested blocker, so the refresh re-lifts the identical
  // question and the row parks with the answer never dispatched.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'PR_FEEDBACK', subPrs: [{ id: 'a', status: 'open', pr: 41, branch: 'fix/a' }], multiPrPending: true })] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', subPrStates: [{ id: 'a', merged: false, readyToMerge: false }] } },
      worker: {
        'FIX-2': {
          phase: 'PR_FEEDBACK',
          multiPrPending: false,
          // BOTH channels, which is what the old guard tripped over.
          blocker: 'a: which shape?',
          subPrs: [{ id: 'a', status: 'open', pr: 41, branch: 'fix/a', blocker: 'which shape?' }],
        },
      },
    }),
  })
  assert.equal(result.issues[0].blockerFor, 'a', 'the marker names the slice the answer will release')

  // ...and that marker is what makes the answer actually land: feeding the row back with the row-level
  // blocker cleared dispatches a worker instead of re-lifting the same question.
  const answered = await run('epic-wake.js', {
    args: epicArgs({
      issues: [{ ...result.issues[0], blocker: null, blockerResolutions: [{ for: null, answer: 'key on tenant + scope' }] }],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', subPrStates: [{ id: 'a', merged: false, readyToMerge: false }] } },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', multiPrPending: false, subPrs: [{ id: 'a', status: 'open', pr: 41, branch: 'fix/a' }] } },
    }),
  })
  assert.deepEqual(workerLabels(answered.calls), ['implement:FIX-2'], 'dispatched, not re-lifted')
})

check('an answer for a slice the nested cap deferred is retained', async () => {
  // `issue-multi-pr` serves only its ready set, so its own cap can defer a blocked slice whose answer is
  // already in hand. Consuming the whole list on "the nested workflow reported back" discarded that
  // answer and the coordinator re-asked a question the human had already settled.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          blockerFor: 'a',
          blockerResolutions: [
            { for: 'a', answer: 'A: key on tenant' },
            { for: 'b', answer: 'B: Bob owns it' },
          ],
          // Both nested blockers are already cleared — the sibling queue clears one per wake, so by the
          // time a worker runs with two answers in hand neither slice is still blocked.
          subPrs: [
            { id: 'a', status: 'pending' },
            { id: 'b', status: 'pending' },
          ],
          multiPrPending: true,
        }),
      ],
    }),
    respond: epicResponder({
      fresh: {
        'FIX-2': {
          phase: 'PR_FEEDBACK',
          subPrStates: [
            { id: 'a', merged: false, readyToMerge: false },
            { id: 'b', merged: false, readyToMerge: false },
          ],
        },
      },
      worker: {
        'FIX-2': {
          phase: 'PR_FEEDBACK',
          multiPrPending: true,
          // `a` was built with its answer applied; `b` was deferred by the nested cap, so it comes back
          // exactly as it went in — unbuilt, and still needing the answer already given for it.
          subPrs: [
            { id: 'a', status: 'open', pr: 41, branch: 'fix/a' },
            { id: 'b', status: 'pending' },
          ],
        },
      },
    }),
  })
  assert.deepEqual(
    result.issues[0].blockerResolutions,
    [{ for: 'b', answer: 'B: Bob owns it' }],
    "the served slice's answer is spent; the deferred slice's waits for the wake that serves it",
  )

  // An answer naming a slice the table no longer has is DROPPED, not hoarded: nothing is left to apply
  // it to, and retaining it would restate a decision at every future worker forever.
  const orphaned = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          blockerFor: 'a',
          blockerResolutions: [{ for: 'gone', answer: 'about a slice that no longer exists' }],
          subPrs: [{ id: 'a', status: 'pending' }],
          multiPrPending: true,
        }),
      ],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', subPrStates: [{ id: 'a', merged: false, readyToMerge: false }] } },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', multiPrPending: true, subPrs: [{ id: 'a', status: 'open', pr: 41, branch: 'fix/a' }] } },
    }),
  })
  assert.deepEqual(orphaned.result.issues[0].blockerResolutions, [], 'dropped, not restated forever')

  // A RE-ESCALATION is not a deferral: the answer was applied and proved insufficient, so re-handing it
  // would present a spent decision as fresh. Changed blocker text is how the two are told apart.
  const reEscalated = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          blockerFor: 'a',
          blockerResolutions: [{ for: 'a', answer: 'A: key on tenant' }],
          subPrs: [{ id: 'a', status: 'pending' }],
          multiPrPending: true,
        }),
      ],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', subPrStates: [{ id: 'a', merged: false, readyToMerge: false }] } },
      worker: {
        'FIX-2': {
          phase: 'PR_FEEDBACK',
          multiPrPending: true,
          subPrs: [{ id: 'a', status: 'pending', blocker: 'tenant key collides with the scope index — drop which?' }],
        },
      },
    }),
  })
  assert.deepEqual(reEscalated.result.issues[0].blockerResolutions, [], 'a new question does not re-serve the old answer')
})

check('a multi-PR answer is retained until the nested workflow reports back', async () => {
  // An outer worker can satisfy its schema while never successfully running `issue-multi-pr` — required
  // fields present, `subPrs` omitted. Consuming the answer there left the decision spent with nothing
  // applied, and the refresh had already cleared the nested blocker, so the unchanged PR became
  // merge-eligible. For a multi-PR row the returned `subPrs` IS the receipt.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          blockerFor: 'a',
          blockerResolutions: [{ for: 'a', answer: 'key on tenant + scope' }],
          subPrs: [{ id: 'a', status: 'open', pr: 41, branch: 'fix/a', blocker: 'which shape?' }],
        }),
      ],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK' } },
      // Schema-valid, and it never reached the workflow.
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', multiPrPending: false } },
    }),
  })
  assert.deepEqual(
    result.issues[0].blockerResolutions,
    [{ for: 'a', answer: 'key on tenant + scope' }],
    'the answer waits for a worker that actually ran the DAG',
  )

  // A SINGLE-PR row is unaffected: its worker is the delivery, so returning at all is the receipt.
  const single = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-3', { phase: 'PR_FEEDBACK', implPr: 9, blockerResolutions: [{ for: null, answer: 'use the adapter' }] })],
    }),
    respond: epicResponder({
      fresh: { 'FIX-3': { phase: 'PR_FEEDBACK', implPr: 9, newPrEvents: true, latestActivityAt: 'new' } },
      worker: { 'FIX-3': { phase: 'PR_FEEDBACK', implPr: 9 } },
    }),
  })
  assert.deepEqual(single.result.issues[0].blockerResolutions, [], 'spent, because that worker was the delivery')
})

check('a CI failure waits when the same scan reports unreadable activity', async () => {
  // `pr-feedback` consumes the review cursor, and an unreadable cursor cannot advance — so dispatching
  // here re-delivered the identical batch every wake and the worker re-posted its replies each time.
  const { calls } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9 })] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9, ciFailed: true, newPrEvents: true, latestActivityAt: null } },
    }),
  })
  assert.deepEqual(workerLabels(calls), [], 'duplicate review replies are not recoverable by waiting')

  // CI alone stays actionable — the guard is about the unreadable activity, not about CI.
  const ciOnly = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9 })] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9, ciFailed: true, newPrEvents: false, latestActivityAt: null } },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9 } },
    }),
  })
  assert.deepEqual(workerLabels(ciOnly.calls), ['pr-feedback:FIX-2'])

  // The guard is specifically about unreadable COMMENT ACTIVITY, not about `cursorUsable` in general:
  // that helper also fails for an incomplete per-handle sub-PR scan, and a CI failure with no comment
  // activity has nothing to re-deliver, so it must not be held hostage to an unrelated scan gap.
  const scanGap = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'PR_FEEDBACK', subPrs: [{ id: 'a', status: 'open', pr: 41, branch: 'fix/a' }] })],
    }),
    respond: epicResponder({
      // `subPrStates` deliberately omitted — an incomplete per-handle scan.
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', ciFailed: true, newPrEvents: false, latestActivityAt: null } },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', multiPrPending: false, subPrs: [{ id: 'a', status: 'open', pr: 41, branch: 'fix/a' }] } },
    }),
  })
  assert.deepEqual(workerLabels(scanGap.calls), ['pr-feedback:FIX-2'], 'a sub-PR scan gap does not hold the CI fix')

  // ...and so does CI alongside activity that CAN be consumed.
  const readable = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9 })] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9, ciFailed: true, newPrEvents: true, latestActivityAt: 'new' } },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9 } },
    }),
  })
  assert.deepEqual(workerLabels(readable.calls), ['pr-feedback:FIX-2'])
})

check('a spec-approval gate is withheld while spec feedback is unreadable', async () => {
  // The sibling of the merge-gate rule, one gate kind over: approval chains STRAIGHT into
  // implementation, so signing off before the newly reported review activity is triaged demotes it to
  // implementer notes instead of weighing whether it changes the spec.
  const { result, calls } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 })] }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8, newSpecReviewEvents: true, latestActivityAt: null } },
    }),
  })
  assert.deepEqual(result.gates.filter((g) => g.kind === 'spec-approval'), [], 'not while nobody can triage that feedback')
  assert.deepEqual(workerLabels(calls), [], 'and the review batch is not consumed either')

  // Quiet, the same row is offered — the withholding tracks the unreadable scan, not the phase.
  const quiet = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 })] }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 } } }),
  })
  assert.deepEqual(quiet.result.gates.filter((g) => g.kind === 'spec-approval').map((g) => g.pr), [8])
})

check('a goal pass with a slice still pending is work, not completion', async () => {
  // `multiPrPhase` needs `allMerged && goalPassed` to call a row DONE, so a pass reported while a slice
  // is pending leaves the phase at PR_FEEDBACK. Suppressing DAG work on the pass alone left that row with
  // no action and no gate — a pending slice has no PR to generate one — parked indefinitely.
  const { calls, result } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          subPrs: [
            { id: 'a', status: 'merged', pr: 41, branch: 'fix/a' },
            { id: 'b', status: 'pending', dependsOn: [] },
          ],
          assembledGoal: { passed: true, evidence: 'ran it' },
          multiPrPending: true,
        }),
      ],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', subPrStates: [{ id: 'a', merged: true, readyToMerge: false }] } },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', multiPrPending: true } },
    }),
  })
  assert.deepEqual(workerLabels(calls), ['implement:FIX-2'], 'the pending slice still gets a wake')
  const dispatch = calls.find((c) => (c.label || '').startsWith('implement:'))
  assert.match(dispatch.prompt, /issue-multi-pr workflow/, 'and it is the DAG path, not a single-PR implement')
  assert.equal(result.issues[0].phase, 'PR_FEEDBACK', 'the row is not DONE while a slice is unmerged')
})

check('a repair PR is not offered for merge while its answer is unapplied', async () => {
  // `assembledGoal.fixPr` lives outside `subPrs`, so the per-slice answer guard never covered it: the
  // human would be invited to merge a repair that ignores the decision they were just asked for.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          subPrs: [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a' }],
          assembledGoal: { passed: false, fixIssue: 'FIX-9', fixPr: 55, owningSubPr: 'a' },
          blockerResolutions: [{ for: 'a', answer: 'key on tenant + scope' }],
        }),
      ],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', repairReadyToMerge: true, subPrStates: [{ id: 'a', merged: true, readyToMerge: false }] } },
    }),
  })
  assert.deepEqual(result.gates.filter((g) => g.repair), [], 'not while the decision is still pending')

  // Once no answer is outstanding the same repair is offered, so this is a guard and not a block.
  const clear = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          subPrs: [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a' }],
          assembledGoal: { passed: false, fixIssue: 'FIX-9', fixPr: 55, owningSubPr: 'a' },
        }),
      ],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', repairReadyToMerge: true, subPrStates: [{ id: 'a', merged: true, readyToMerge: false }] } },
    }),
  })
  assert.deepEqual(clear.result.gates.filter((g) => g.repair).map((g) => g.pr), [55])
})

check('a scan reporting a null PR handle does not destroy it', async () => {
  // Both handles are declared `['number','null']`, so a scout nulling one was schema-valid and the spread
  // destroyed it: an approval gate with no PR to approve, or a lost merge-gate and subscription source,
  // with nothing able to re-derive the number.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 }), row('FIX-3', { phase: 'PR_FEEDBACK', implPr: 9 })],
    }),
    respond: epicResponder({
      fresh: {
        'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: null },
        'FIX-3': { phase: 'PR_FEEDBACK', implPr: null },
      },
    }),
  })
  const byId = Object.fromEntries(result.issues.map((r) => [r.id, r]))
  assert.equal(byId['FIX-2'].specPr, 8, 'the durable handle survives an unobserving scan')
  assert.equal(byId['FIX-3'].implPr, 9)
  assert.deepEqual(
    result.gates.filter((g) => g.kind === 'spec-approval').map((g) => g.pr),
    [8],
    'so the gate points at something',
  )

  // The WORKER path needs the same rule. Its guard checked `=== undefined`, so an omission was tolerated
  // and an explicit null — equally schema-valid — still wiped the handle.
  const viaWorker = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9, verdicts: [{ claim: 'c', verdict: 'CONFIRMED', evidence: 'e' }] })],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9 } },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: null } },
    }),
  })
  assert.deepEqual(workerLabels(viaWorker.calls), ['apply-verdict:FIX-2'])
  assert.equal(viaWorker.result.issues[0].implPr, 9, 'a worker cannot null it either')
})

check('an answered escalation dispatches the worker that applies it', async () => {
  // The read channel that was missing from the merge-gate guards: the gate correctly withholds while an
  // answer is unapplied, the worker correctly reports `multiPrPending: false` while waiting for the
  // human, and nothing dispatched the worker that applies the answer — so the row sat with no action and
  // no gate forever. An answered repair blocker is the same shape one level down.
  for (const [label, over] of [
    // `blockerFor` is what the coordinator sets when it surfaces a nested blocker, and it is what the
    // resolution pass uses to clear the right slice. Without it the row re-lifts and parks instead.
    [
      'a blockered slice',
      {
        blockerFor: 'a',
        subPrs: [{ id: 'a', status: 'open', pr: 41, branch: 'fix/a', blocker: 'which shape?' }, { id: 'b', status: 'pending', dependsOn: ['a'] }],
      },
    ],
    // An OPEN repair PR is where the ordering earns its place: `goal.fixPr && !goal.fixMerged` returns
    // false just below, so a decision escalated from feedback on that PR would be queued behind a
    // waiting state and never dispatched.
    [
      'an open repair PR',
      {
        subPrs: [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a' }],
        assembledGoal: { passed: false, failure: 'disagree on the cache key', fixIssue: 'FIX-9', fixPr: 55, owningSubPr: 'a' },
      },
    ],
    [
      'a blocked repair',
      {
        subPrs: [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a' }],
        assembledGoal: { passed: false, failure: 'disagree on the cache key', fixIssue: 'FIX-9', fixBlocker: 'which shape?', owningSubPr: 'a' },
      },
    ],
  ]) {
    const { calls } = await run('epic-wake.js', {
      args: epicArgs({
        issues: [row('FIX-2', { phase: 'PR_FEEDBACK', multiPrPending: false, blockerResolutions: [{ for: 'a', answer: 'key on tenant + scope' }], ...over })],
      }),
      respond: epicResponder({ fresh: { 'FIX-2': { phase: 'PR_FEEDBACK' } } }),
    })
    assert.deepEqual(workerLabels(calls), ['implement:FIX-2'], `dispatched for ${label}`)
  }

  // It buys exactly ONE dispatch: the returned row carries no resolutions, so the next wake is quiet
  // again. That is what keeps "a queued answer is work" from re-dispatching a no-op forever.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          multiPrPending: false,
          blockerResolutions: [{ for: 'a', answer: 'key on tenant + scope' }],
          blockerFor: 'a',
          // PENDING, so the build that opens the PR is an observable delivery — an already-open slice
          // coming back open proves nothing (that is the failed-resume case) and keeps its answer.
          subPrs: [{ id: 'a', status: 'pending', blocker: 'which shape?' }],
        }),
      ],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK' } },
      // A worker that actually ran the DAG returns its table — that return IS the receipt for a
      // multi-PR answer, so a fixture omitting it describes a worker which never got there.
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', multiPrPending: false, subPrs: [{ id: 'a', status: 'open', pr: 41, branch: 'fix/a' }] } },
    }),
  })
  assert.deepEqual(result.issues[0].blockerResolutions, [], 'spent by a worker that reported the DAG state')
})

check('a scan-derived spec approval needs a head to approve', async () => {
  // `approvedInSessionFor` has enforced this one function away all along: an approval naming no head
  // cannot be shown to apply to the spec PR's current content. The scan channel was the looser of the
  // two, which is backwards — it is the one with no human in the loop this wake.
  const { calls } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 })] }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8, specApproved: true, headSha: null } } }),
  })
  assert.deepEqual(workerLabels(calls), [], 'a headless approval implements nothing')

  const withHead = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 })] }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8, specApproved: true, headSha: 'def' } } }),
  })
  assert.deepEqual(workerLabels(withHead.calls), ['implement:FIX-2'], 'and with one it releases')
})

check('a slice added after the goal passed invalidates that proof', async () => {
  // A goal proof covers the slice set it was RUN against. Preserving it across an added slice meant the
  // row went DONE the moment that slice merged — end-to-end evidence that never exercised the code it
  // claimed to cover.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          subPrs: [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a' }],
          assembledGoal: { passed: true, evidence: 'fsdev run: PASS', failure: 'disagree on the cache key', fixIssue: 'FIX-9' },
          verdicts: [{ claim: 'c', verdict: 'REFUTED', evidence: 'ran it' }],
        }),
      ],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', subPrStates: [{ id: 'a', merged: true, readyToMerge: false }] } },
      worker: {
        'FIX-2': {
          phase: 'PR_FEEDBACK',
          multiPrPending: true,
          // The verdict fold added a slice to a plan whose goal had already passed.
          subPrs: [
            { id: 'a', status: 'merged', pr: 41, branch: 'fix/a' },
            { id: 'c', status: 'pending', dependsOn: [] },
          ],
        },
      },
    }),
  })
  const goal = result.issues[0].assembledGoal
  assert.equal(goal.passed, undefined, 'the stale proof is dropped')
  assert.equal(goal.evidence, undefined)
  // ONLY the proof. The failure, gap issue and repair handle are still true of the work done so far, and
  // clearing them would restart the gap/repair cycle from scratch on top of the re-run.
  assert.equal(goal.failure, 'disagree on the cache key')
  assert.equal(goal.fixIssue, 'FIX-9')
  assert.equal(result.issues[0].phase, 'PR_FEEDBACK')

  // A plan that did NOT change keeps its proof — otherwise the goal would re-run every wake forever.
  const unchanged = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          subPrs: [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a' }],
          assembledGoal: { passed: true, evidence: 'fsdev run: PASS' },
          verdicts: [{ claim: 'c', verdict: 'REFUTED', evidence: 'ran it' }],
        }),
      ],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', subPrStates: [{ id: 'a', merged: true, readyToMerge: false }] } },
      worker: { 'FIX-2': { phase: 'PR_FEEDBACK', multiPrPending: false, subPrs: [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a' }] } },
    }),
  })
  assert.equal(unchanged.result.issues[0].assembledGoal.passed, true)
})

check('a merge gate is withheld while the epic objective is unapproved', async () => {
  // The objective gate holds the child RAMP, and a merge is the terminal step of that ramp — the one
  // outcome the gate cannot undo. Only the spec-approval gate carried this condition; the merge gate,
  // which is the more consequential of the two, did not.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9 })] }),
    respond: epicResponder({ approved: false, fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9, readyToMerge: true } } }),
  })
  assert.deepEqual(result.gates.filter((g) => g.kind === 'merge'), [], 'nothing lands under an objective nobody approved')
  assert.deepEqual(
    result.gates.map((g) => g.kind),
    ['epic-objective'],
    'and the gate that unblocks it is the one surfaced, so this is a sequence and not a dead end',
  )

  // Approved: the same row is offered, which is what makes the withholding above a sequencing rule.
  const approved = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9 })] }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9, readyToMerge: true } } }),
  })
  assert.deepEqual(approved.result.gates.filter((g) => g.kind === 'merge').map((g) => g.pr), [9])
})

check('a POC verdict that lands after the issue completed is still folded', async () => {
  // A POC is non-blocking by design, so it can finish after the implementation PR merged and Linear moved
  // to Done. Parking on terminal state first meant that verdict was never applied: not recorded, no
  // evidence-backed reply on its thread, and the epic wrapped as though the question was never asked.
  const { calls } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'DONE', merged: true, implPr: 9, verdicts: [{ claim: 'c', verdict: 'REFUTED', evidence: 'ran it' }] })],
    }),
    respond: (prompt, opts) => {
      const label = opts.label || ''
      if (label === 'gate:epic') return { approved: true, approvedByLabel: false, approver: 'jake', headSha: 'abc', newReviewEvents: false, latestActivityAt: null }
      if (label === 'linear:epic-children') return { issues: [{ id: 'FIX-2', state: 'Done', blockedBy: [] }] }
      if (label.startsWith('refresh:')) return { issueId: 'FIX-2', ...freshRow({ phase: 'DONE', merged: true, implPr: 9 }) }
      return workerRes({ issueId: 'FIX-2', phase: 'DONE' })
    },
  })
  assert.deepEqual(workerLabels(calls), ['apply-verdict:FIX-2'], 'the landed verdict is applied to completed work')

  // CANCELLED work is different — there is nothing to fold a verdict into — and it is dropped out loud.
  const cancelled = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9, verdicts: [{ claim: 'c', verdict: 'REFUTED', evidence: 'ran it' }] })],
    }),
    respond: (prompt, opts) => {
      const label = opts.label || ''
      if (label === 'gate:epic') return { approved: true, approvedByLabel: false, approver: 'jake', headSha: 'abc', newReviewEvents: false, latestActivityAt: null }
      if (label === 'linear:epic-children') return { issues: [{ id: 'FIX-2', state: 'Canceled', blockedBy: [] }] }
      if (label.startsWith('refresh:')) return { issueId: 'FIX-2', ...freshRow({ phase: 'PR_FEEDBACK', implPr: 9 }) }
      return workerRes({ issueId: 'FIX-2' })
    },
  })
  assert.deepEqual(workerLabels(cancelled.calls), [], 'cancelled work folds nothing')
})

check('a worker cannot promote a sub-PR to merged, only open it', async () => {
  // Status is an observation and a worker is not the observer: workers build and push, never merge, and
  // only the refresh scout reads PR metadata. A reported `merged` unlocks dependents onto origin/main and
  // can run the assembled goal while that PR is still open; a reported `pending` rebuilds an open one.
  const { result } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [
        row('FIX-2', {
          phase: 'PR_FEEDBACK',
          subPrs: [
            { id: 'a', status: 'open', pr: 41, branch: 'fix/a' },
            { id: 'b', status: 'pending', dependsOn: ['a'] },
          ],
          assembledGoal: { passed: false },
          multiPrPending: true,
        }),
      ],
    }),
    respond: epicResponder({
      fresh: {
        'FIX-2': {
          phase: 'PR_FEEDBACK',
          subPrStates: [
            { id: 'a', merged: false, readyToMerge: false },
            { id: 'b', merged: false, readyToMerge: false },
          ],
        },
      },
      worker: {
        'FIX-2': {
          phase: 'PR_FEEDBACK',
          multiPrPending: true,
          // `a` claimed merged (it is not), `b` legitimately opened.
          subPrs: [
            { id: 'a', status: 'merged', pr: 41, branch: 'fix/a' },
            { id: 'b', status: 'open', pr: 42, branch: 'fix/b' },
          ],
        },
      },
    }),
  })
  const byId = Object.fromEntries(result.issues[0].subPrs.map((sp) => [sp.id, sp]))
  assert.equal(byId.a.status, 'open', 'a worker-claimed merge is refused; only the scan can observe one')
  assert.equal(byId.b.status, 'open', 'pending → open is the transition the worker does own')
})

check('one claim argued with different framings settles once, testing both', async () => {
  // The dedupe key is normalized prose on purpose (independent workers phrase a claim differently), which
  // means two issues can collide on wording while meaning it about different load-bearing paths. Keeping
  // only the first request's framing would have the POC exercise one path and the verdict fan to both — a
  // verdict presented as evidence for something it never ran.
  const { calls } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 }), row('FIX-3', { phase: 'AWAITING_SPEC_APPROVAL', specPr: 9 })],
      settleRequests: [
        { claim: 'SSE resumes after a redeploy', load: 'FIX-2 buffers client-side', falsify: 'kill the server mid-stream', issueId: 'FIX-2' },
        { claim: 'SSE  resumes after a  redeploy', load: 'FIX-3 replays from the store', falsify: 'restart with a cold store', issueId: 'FIX-3' },
      ],
    }),
    respond: epicResponder({
      fresh: {
        'FIX-2': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 8 },
        'FIX-3': { phase: 'AWAITING_SPEC_APPROVAL', specPr: 9 },
      },
    }),
  })
  const pocs = calls.filter((c) => (c.label || '').startsWith('poc:'))
  assert.equal(pocs.length, 1, 'still one settlement — that is the point of the dedupe')
  assert.match(pocs[0].prompt, /kill the server mid-stream/)
  assert.match(pocs[0].prompt, /restart with a cold store/, "the second issue's falsification is not dropped")
  assert.match(pocs[0].prompt, /FIX-2 buffers client-side/)
  assert.match(pocs[0].prompt, /FIX-3 replays from the store/)
})

check('a build worker that dies leaves the human decision unspent', async () => {
  // The blocker used to be cleared before dispatch for a pending slice ("the build is the delivery").
  // When that build died the node persisted already-unblocked while the caller consumed the one-shot
  // resolution, so the next worker reached the fork with nothing and had to re-escalate or guess.
  const { result } = await run('issue-multi-pr.js', {
    args: multiArgs({
      subPrs: [{ id: 'a', status: 'pending', dependsOn: [], blocker: 'which shape?' }],
      blockerResolutions: [{ for: 'a', answer: 'key on tenant + scope' }],
    }),
    respond: multiResponder({ nulls: ['build:a'] }),
  })
  assert.equal(result.subPrs[0].blocker, 'which shape?', 'a dead worker mutates nothing — the question stands')

  // And a build that RETURNS spends it, which is what makes the above a failure path and not the norm.
  const delivered = await run('issue-multi-pr.js', {
    args: multiArgs({
      subPrs: [{ id: 'a', status: 'pending', dependsOn: [], blocker: 'which shape?' }],
      blockerResolutions: [{ for: 'a', answer: 'key on tenant + scope' }],
    }),
    respond: multiResponder(),
  })
  assert.equal(delivered.result.subPrs[0].blocker, null)
  assert.equal(delivered.result.subPrs[0].status, 'open')
})

check('an answered repair releases the fix, and only a returning worker spends the answer', async () => {
  const repairArgs = (over = {}) => ({
    issueId: 'FIX-2',
    subPrs: [{ id: 'a', status: 'merged', pr: 41, branch: 'fix/a', dependsOn: [] }],
    assembledGoal: {
      passed: false,
      failure: 'the two slices disagree on the cache key',
      evidence: 'ran it',
      fixIssue: 'FIX-9',
      owningSubPr: 'a',
      fixBlocker: 'which shape?',
    },
    blockerResolutions: [{ for: 'a', answer: 'key on tenant + scope' }],
    ...over,
  })
  const opened = await run('issue-multi-pr.js', { args: repairArgs(), respond: multiResponder() })
  assert.deepEqual(
    opened.calls.filter((c) => (c.label || '').startsWith('assembled-fix')).map((c) => c.label),
    ['assembled-fix:FIX-2'],
  )
  assert.equal(opened.result.assembledGoal.fixPr, 42)
  assert.equal(opened.result.assembledGoal.fixBlocker, null, 'the answer was delivered into a PR, so it is spent')

  // Dead fix worker: the blocker survives, so the decision is asked again rather than lost.
  const died = await run('issue-multi-pr.js', {
    args: repairArgs(),
    respond: multiResponder({ nulls: ['assembled-fix:'] }),
  })
  assert.equal(died.result.assembledGoal.fixBlocker, 'which shape?')
  assert.equal(died.result.assembledGoal.fixPr, undefined)
})

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
  // `a` is dispatchable and `b` is not: a dependency that hasn't even opened a PR is not a base.
  // This check used to reach for `status: 'building'` to make `a` undispatchable, which quietly
  // asserted that a carried `building` node waits forever — the stall review found. The fixture
  // now uses only statuses the script actually knows.
  const { result, calls } = await run('issue-multi-pr.js', {
    args: multiArgs({ subPrs: [node('a'), node('b', { dependsOn: ['a'] })] }),
    respond: multiResponder(),
  })
  assert.deepEqual(
    calls.map((c) => c.label),
    ['build:a'],
    'only the independent node builds; the dependent waits for a base',
  )
  assert.equal(result.subPrs.find((n) => n.id === 'b').status, 'pending')
  assert.equal(result.done, false)
})

check('a carried "building" status retries the build instead of waiting forever', async () => {
  const { result, calls, logs } = await run('issue-multi-pr.js', {
    args: multiArgs({ subPrs: [node('a', { status: 'building' })] }),
    respond: multiResponder(),
  })
  // Nothing external can ever move a `building` node — no PR exists to comment on or merge — so
  // parking on it is permanent. It normalizes to `pending` and the build is retried.
  assert.deepEqual(
    calls.map((c) => c.label),
    ['build:a'],
  )
  assert.match(logs.join('\n'), /carried status "building" is not a state a wake can resume/)
  assert.notEqual(result.subPrs[0].status, 'building', 'and the status the script cannot act on does not survive the wake')
})

check('a duplicate sub-PR id is refused before anything is dispatched', async () => {
  // `byId` collapses the pair while the loop still visits both rows, so both would build and push
  // the SAME branch concurrently and one result would be applied to both.
  const { result, calls, logs } = await run('issue-multi-pr.js', {
    args: multiArgs({ subPrs: [node('a'), node('a'), node('b')] }),
    respond: multiResponder(),
  })
  assert.deepEqual(
    calls.map((c) => c.label),
    [],
    'a malformed plan builds NOTHING — `byId` is what every other node is classified against, so a bad row poisons its descendants',
  )
  assert.ok(result.invalid.some((i) => i.id === 'a' && i.duplicate))
  assert.match(logs.join('\n'), /a: appears MORE THAN ONCE in the plan/)
})

check('the assembled goal always runs on the real path — there is no confirm-a-record path', async () => {
  // The `ownedBy` shortcut ("a designated slice already ran it, confirm its verdict") was removed:
  // nothing ever set the field, and the one time it got exercised it accepted a verdict recorded
  // before a repair merged. Saving one real-path run is not worth a stale proof.
  const src = readFileSync(join(HERE, 'issue-multi-pr.js'), 'utf8')
  assert.doesNotMatch(src, /goal\.ownedBy/, 'the unreachable shortcut is gone, not just bypassed')

  for (const goal of [{}, { fixMerged: true, fixPr: 77, fixIssue: 'FIX-50', failure: 'f' }]) {
    const { calls } = await run('issue-multi-pr.js', {
      args: multiArgs({ subPrs: [node('a', { status: 'merged' })], assembledGoal: goal }),
      respond: (prompt, opts) => ((opts.label || '').startsWith('assembled-goal:') ? { passed: true, evidence: 'ran it' } : {}),
    })
    const prompt = calls.find((c) => (c.label || '').startsWith('assembled-goal:')).prompt
    assert.match(prompt, /run the spec's end-to-end goal against the fully-assembled result/)
    assert.doesNotMatch(prompt, /do not re-run/)
  }
})

check('a failed assembled goal keeps its evidence and hands it to the repair', async () => {
  // `evidence` is schema-required because it carries the command and the observed result. The gap
  // and repair workers are the ones that have to reproduce the failure.
  const first = await run('issue-multi-pr.js', {
    args: multiArgs({ subPrs: [node('a', { status: 'merged' })], assembledGoal: { goal: 'g' } }),
    respond: (prompt, opts) =>
      (opts.label || '').startsWith('assembled-goal:')
        ? { passed: false, evidence: 'ran `fsdev run x` → exit 1, stream closed early', failure: 'stream closed early' }
        : {},
  })
  assert.equal(first.result.assembledGoal.evidence, 'ran `fsdev run x` → exit 1, stream closed early')

  // The gap worker gets it, not just the terse failure line.
  const second = await run('issue-multi-pr.js', {
    args: multiArgs({ subPrs: [node('a', { status: 'merged' })], assembledGoal: { ...first.result.assembledGoal } }),
    respond: (prompt, opts) => ((opts.label || '').startsWith('assembled-gap:') ? { issueFiled: 'FIX-50', ready: true } : {}),
  })
  const gap = second.calls.find((c) => (c.label || '').startsWith('assembled-gap:'))
  assert.match(gap.prompt, /stream closed early/)
  assert.match(gap.prompt, /Evidence \(what was run and what happened\)/)
})

check('a build result echoing another sub-PR id is discarded, not applied to it', async () => {
  const { result, logs } = await run('issue-multi-pr.js', {
    args: multiArgs({ subPrs: [node('a'), node('b')] }),
    respond: (prompt, opts) => {
      const label = opts.label || ''
      // `b`'s worker reports `a`'s id along with its own handles.
      if (label === 'build:b') return { id: 'a', status: 'open', pr: 42, branch: 'fix/FIX-9-b', summary: 'done' }
      return { id: 'a', status: 'open', pr: 41, branch: 'fix/FIX-9-a', summary: 'done' }
    },
  })
  const a = result.subPrs.find((n) => n.id === 'a')
  const b = result.subPrs.find((n) => n.id === 'b')
  assert.equal(a.pr, 41, "a keeps its own worker's PR")
  assert.equal(a.branch, 'fix/FIX-9-a')
  assert.equal(b.status, 'pending', 'a discarded result leaves the node to retry, not half-applied')
  assert.equal(b.pr, null)
  assert.match(logs.join('\n'), /b: worker reported id a — discarding the result/)
})

check('an open dependency with no PR number is waited on, never used as a base', async () => {
  // A branch is enough to build ON, but with no PR the prerequisite can never be reviewed or merged
  // — and `classify` only rebases a stacked dependent once its deps have MERGED, so stacking on it
  // strands both slices with no remaining action at all.
  const { calls } = await run('issue-multi-pr.js', {
    args: multiArgs({
      subPrs: [node('a', { status: 'open', pr: null, branch: 'fix/a' }), node('b', { dependsOn: ['a'] })],
    }),
    respond: multiResponder(),
  })
  assert.deepEqual(calls.map((c) => c.label), [], 'a dependency with no mergeable handle is not a base')
})

check('an open dependency with no branch is waited on, never used as a base', async () => {
  // `base: undefined` tells the worker to build on nothing — it would start from the inherited
  // checkout instead of its prerequisite, which is a wrong implementation, not a delay.
  const { calls, logs } = await run('issue-multi-pr.js', {
    args: multiArgs({
      subPrs: [node('a', { status: 'open', pr: 41, branch: null }), node('b', { dependsOn: ['a'] })],
    }),
    respond: multiResponder(),
  })
  assert.deepEqual(calls.map((c) => c.label), [], 'the dependent waits for a usable base')
  assert.match(logs.join('\n'), /No sub-PR is ready/)
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
  assert.match(calls[0].prompt, /rebase it onto fresh origin\/main/)
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
    respond: multiResponder({ goal: { passed: false, evidence: 'fsdev run: FAIL at resume', failure: 'stream stalls on resume', owningSubPr: 'b' } }),
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

check('a dependency CYCLE is reported invalid, not parked forever', async () => {
  // No merge and no other event can unblock a cycle, so "waiting" would be a silent permanent
  // stall. Only a human fixing the plan resolves it.
  const { result, calls, logs } = await run('issue-multi-pr.js', {
    args: multiArgs({ subPrs: [node('a', { dependsOn: ['b'] }), node('b', { dependsOn: ['a'] })] }),
    respond: multiResponder(),
  })
  assert.deepEqual(calls, [], 'nothing is built out of a cyclic plan')
  assert.deepEqual(result.invalid.map((i) => i.id).sort(), ['a', 'b'])
  assert.ok(result.invalid.every((i) => i.cycle))
  assert.match(logs.join('\n'), /part of a dependency CYCLE — no event can unblock it/)
})

check('a terminal Linear issue stops asking the human to merge it', async () => {
  const { result } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9 })] }),
    respond: (prompt, opts) => {
      const label = opts.label || ''
      if (label === 'gate:epic') return { approved: true, approvedByLabel: false, headSha: 'abc', newReviewEvents: false, latestActivityAt: null }
      if (label === 'linear:epic-children') return { issues: [{ id: 'FIX-2', state: 'Canceled', blockedBy: [] }] }
      if (label.startsWith('refresh:')) return { issueId: 'FIX-2', ...freshRow({ phase: 'PR_FEEDBACK', implPr: 9, readyToMerge: true }) }
      return { issueId: 'FIX-2', ...workerRes() }
    },
  })
  assert.deepEqual(result.gates, [], 'a dropped child must not surface a merge gate')
})

check('recovered CI stops looking like a failure', async () => {
  const { calls } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9, ciFailed: true })] }),
    respond: epicResponder({ fresh: { 'FIX-2': { phase: 'PR_FEEDBACK', implPr: 9, ciFailed: false } } }),
  })
  assert.deepEqual(workerLabels(calls), [], 'a stale ciFailed would re-dispatch pr-feedback forever')
})

check('an approval with no current head holds work for the wake', async () => {
  const { result, calls, logs } = await run('epic-wake.js', {
    args: epicArgs({ epic: { issueId: 'FIX-1', branch: 'epic/t', prNumber: 100, headSha: 'preapproval' }, issues: [row('FIX-2')] }),
    respond: (prompt, opts) => {
      const label = opts.label || ''
      // Schema-valid but headSha null: we cannot align workers to the approved objective.
      if (label === 'gate:epic') return { approved: true, approvedByLabel: false, headSha: null, newReviewEvents: false, latestActivityAt: null }
      if (label === 'linear:epic-children') return { issues: [{ id: 'FIX-2', state: 'Todo', blockedBy: [] }] }
      if (label.startsWith('refresh:')) return { issueId: 'FIX-2', ...freshRow() }
      return { issueId: 'FIX-2', ...workerRes() }
    },
  })
  assert.equal(result.epicApproved, false, 'a live scan with no head releases nothing, whatever it says about approval')
  assert.deepEqual(workerLabels(calls), [], 'no worker aligns to a pre-approval objective')
  assert.match(logs.join('\n'), /Epic gate scan returned no current head — holding work this wake/)
})

check('a node declaring an unknown dependency fails closed', async () => {
  // filter(Boolean) would drop the missing id, leaving zero deps — which reads as "all merged"
  // and builds the dependent onto origin/main before its prerequisite exists.
  const { result, calls, logs } = await run('issue-multi-pr.js', {
    args: multiArgs({ subPrs: [node('b', { dependsOn: ['ghost'] })] }),
    respond: multiResponder(),
  })
  assert.deepEqual(calls, [], 'never build a node whose declared dependency is not in the table')
  assert.deepEqual(result.invalid, [{ id: 'b', missing: ['ghost'], cycle: false, duplicate: false }])
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
    respond: multiResponder({ goal: { passed: false, evidence: 'fsdev run: FAIL', failure: 'still broken', owningSubPr: 'a' } }),
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

  // Next wake: it RE-CHECKS rather than parking on the cached verdict — a blocked state with no
  // way to observe its blocker clearing is a stall, not a wait.
  const stillBlocked = await run('issue-multi-pr.js', {
    args: multiArgs({ subPrs: [node('a', { status: 'merged' })], assembledGoal: result.assembledGoal }),
    respond: multiResponder({ gap: { issueFiled: 'FIX-99', ready: false } }),
  })
  assert.deepEqual(stillBlocked.calls.map((c) => c.label), ['gap-recheck:FIX-9'], 're-derives readiness')
  assert.equal(stillBlocked.calls[0].agentType, 'scout', 'a cheap read, not repair work')
  assert.equal(stillBlocked.result.blockedGap, 'FIX-99')

  // And once the blocker clears externally, the repair actually resumes.
  const unblocked = await run('issue-multi-pr.js', {
    args: multiArgs({ subPrs: [node('a', { status: 'merged' })], assembledGoal: result.assembledGoal }),
    respond: multiResponder({ gap: { issueFiled: 'FIX-99', ready: true } }),
  })
  assert.equal(unblocked.result.assembledGoal.fixReady, true)
  const resumed = await run('issue-multi-pr.js', {
    args: multiArgs({ subPrs: [node('a', { status: 'merged' })], assembledGoal: unblocked.result.assembledGoal }),
    respond: multiResponder(),
  })
  assert.deepEqual(resumed.calls.map((c) => c.label), ['assembled-fix:FIX-9'], 'the repair resumes, not stalls')
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

check('INVARIANT: every schema is satisfiable', async () => {
  // A `required` field absent from `properties` under `additionalProperties: false` is
  // UNSATISFIABLE — omit it and `required` fails, include it and `additionalProperties` fails, so
  // every response from that agent is rejected and the lifecycle silently never advances. This is
  // trivially checkable and it caught exactly that in WORKER_SCHEMA, introduced by a bulk edit
  // whose replace-all hit a second schema. Every schema in both scripts, every time.
  for (const file of ['epic-wake.js', 'issue-multi-pr.js']) {
    const src = readFileSync(join(HERE, file), 'utf8')
    for (const m of src.matchAll(/const (\w+_SCHEMA) = \{/g)) {
      // Brace-match the whole declaration. A fixed-size window silently truncated WORKER_SCHEMA
      // once a nested sub-schema pushed a later property past the cut, and reported the schema as
      // unsatisfiable when it wasn't — a check that fails for the wrong reason is as bad as one
      // that passes for the wrong reason.
      const seg = balancedFrom(src, m.index)
      const req = /required: \[([^\]]*)\]/.exec(seg)
      if (!req) continue
      const fields = req[1].split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean)
      // Property keys are the ones indented inside this schema's `properties` block.
      const props = [...seg.matchAll(/^ {4}(\w+):/gm)].map((x) => x[1])
      const closed = /additionalProperties: false/.test(seg)
      for (const f of fields) {
        assert.ok(
          props.includes(f),
          `${file}: ${m[1]} requires "${f}" but never declares it${closed ? ' (and is additionalProperties:false — UNSATISFIABLE)' : ''}`,
        )
      }
    }
  }
})

check('INVARIANT: every phase a row can hold is one the state machine handles', async () => {
  // A phase is the row's whole program counter: `pendingAction` switches on it and `nextRow`
  // persists whatever a worker reported. So a value outside the set the switch handles is a row
  // that can never be acted on again, carrying no gate and no blocker to say why — a silent park.
  // Review found `WORKER_SCHEMA.phase` as a free-form string; this asserts the two sides agree in
  // both directions, so adding a phase to the machine without the schema (or the reverse) fails.
  const { pendingAction, LIFECYCLE_PHASES } = loadRules('epic-wake.js', ['atReviewBudget', 'LIFECYCLE_PHASES', 'pendingAction'])
  const src = readFileSync(join(HERE, 'epic-wake.js'), 'utf8')

  // Every schema that carries a phase constrains it to the SAME shared set.
  for (const schema of ['PR_STATE_SCHEMA', 'WORKER_SCHEMA']) {
    const at = src.indexOf(`const ${schema} =`)
    assert.ok(at > 0, `${schema} not found`)
    const body = src.slice(at, at + 1600)
    assert.match(
      body,
      /phase: \{ type: 'string', enum: LIFECYCLE_PHASES \}/,
      `${schema}.phase is not constrained to LIFECYCLE_PHASES — a free-form value gets persisted and then parks the row forever`,
    )
  }

  // And the machine covers the set: every phase either dispatches or is a deliberate terminal.
  const terminal = ['DONE']
  for (const phase of LIFECYCLE_PHASES) {
    if (terminal.includes(phase)) continue
    // At least one input in this phase must produce an action, or the phase is unreachable work.
    const anyAction = [
      { phase, specApproved: true },
      { phase, newSpecReviewEvents: true, latestActivityAt: 'new' },
      { phase, newPrEvents: true, latestActivityAt: 'new' },
      { phase, ciFailed: true },
      { phase },
    ].some((r) => pendingAction(r))
    assert.ok(anyAction, `${phase} is in the schema enum but no input in it ever dispatches — a row that reaches it is stuck`)
  }
  assert.ok(LIFECYCLE_PHASES.length >= 5)

  // The same rule for the OTHER field a state machine switches on. `subPrs[].status` is persisted by
  // epic-wake and consumed by issue-multi-pr's classify(), so a free-form value there stalls a slice
  // exactly as a free-form phase stalled a row — the class is "a persisted program counter is
  // enum-constrained", not "the row's phase is". Review found this instance after the phase one.
  const multiSrc = readFileSync(join(HERE, 'issue-multi-pr.js'), 'utf8')
  const subPrStatus = /status: \{ type: 'string', enum: \[([^\]]*)\] \}/.exec(balancedFrom(src, src.indexOf('const WORKER_SCHEMA =')))
  assert.ok(subPrStatus, "WORKER_SCHEMA's subPrs[].status is not enum-constrained — a typo would stall the slice silently")
  const declared = subPrStatus[1].split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean)
  // Every status the DAG's classify() actually branches on has to be declarable, and nothing else.
  for (const st of ['pending', 'open', 'merged']) {
    assert.ok(declared.includes(st), `classify() handles "${st}" but the schema cannot express it`)
    assert.ok(
      multiSrc.includes(`'${st}'`) || (st === 'merged' && multiSrc.includes('TERMINAL')),
      `the schema declares "${st}" but issue-multi-pr never handles it`,
    )
  }
  assert.equal(declared.length, 3, `unexpected sub-PR statuses declared: ${declared.join(', ')}`)
})

/**
 * Every top-level SCREAMING_CASE const in a workflow script, evaluated as real values.
 *
 * The schemas reference each other (`settleRequested: SETTLE_REQUESTED_SCHEMA`) and the shared phase
 * enum, so they can only be read together. Evaluating them beats string-matching their `required` lists:
 * a text search across a whole schema cannot tell the top-level scope from a nested item scope, which is
 * exactly how a field required only inside `subPrStates.items` read as required at the top level.
 */
function loadSchemas(file) {
  const src = readFileSync(join(HERE, file), 'utf8')
  const names = []
  const decls = []
  const seen = new Set()
  for (const m of src.matchAll(/^const ([A-Z][A-Z0-9_]*) =/gm)) {
    // A name can appear twice in a script that declares a local shadow; keep the first, since the
    // schemas are declared once at the top level and a duplicate `const` would not evaluate.
    if (seen.has(m[1])) continue
    seen.add(m[1])
    decls.push(balancedDecl(src, m.index))
    names.push(m[1])
  }
  return new Function(`${decls.join('\n')}\nreturn { ${names.join(', ')} }`)()
}

check('INVARIANT: every gating field is schema-required', async () => {
  // Four separate defects across two rounds were the SAME shape: an optional schema boolean whose
  // omission got defaulted the permissive way — `specApproved` (implement on an unapproved head),
  // `ready` (repair a gap the manager blocked), `aboveBar` (revoke the third round),
  // `newReviewEvents` (skip feedback while advancing its cursor). This asserts the class shut:
  // if the script BRANCHES on a schema field, that field must be required.
  const gating = {
    'epic-wake.js': {
      GATE_SCHEMA: ['approved', 'newReviewEvents'],
      // `merged` joined this list once completion was derived from it in both directions: optional, a
      // scan could report DONE and omit it, and the corrected demotion then had no action and no gate,
      // parking the row for good.
      // `headSha` joined when the scan-derived approval started requiring one: an approval that names no
      // head cannot be shown to apply to the spec PR's current content, and the in-session channel had
      // enforced that from the start. A behavioural check cannot pin it — the shared fixture always
      // supplies a head — so this is the only place the requirement itself is asserted.
      PR_STATE_SCHEMA: ['specApproved', 'newSpecReviewEvents', 'newPrEvents', 'readyToMerge', 'merged', 'headSha'],
      // `multiPrPending` earns its place here for a reason the others don't share: it was optional AND
      // had no clearing path, because the prompt asked only for the true case. So an omission had to
      // preserve the carried value (coercing it to false strands cap-deferred slices no event will
      // wake) — which made a `true` permanent, kept `multiPrHasWork` true on every wake, and under a
      // cap of 2 with a stable row order starved every other issue in the epic. Required, there is no
      // omission to interpret and both readings of the fold rule collapse to the same one; optional,
      // no behavioural check can tell them apart, so this is the only place the fix can be pinned.
      WORKER_SCHEMA: ['phase', 'readyToMerge', 'multiPrPending'],
      EPIC_FOLD_SCHEMA: ['roundsSpent', 'aboveBar'],
      POC_SCHEMA: ['claim', 'verdict', 'evidence'],
      // Nested, and the reason this list now reaches nested `required` blocks at all: `blockedBy`
      // gates admission to the active set, the code reads a present row as authoritative, and the
      // field sat inside `issues.items` where a top-level-only check could not see it. An omission
      // therefore read as "no blockers" and dispatched an issue alongside its prerequisite.
      LINEAR_SCHEMA: ['blockedBy'],
    },
    'issue-multi-pr.js': {
      GAP_SCHEMA: ['issueFiled', 'ready'],
      GOAL_SCHEMA: ['passed', 'evidence'],
      BUILD_SCHEMA: ['id', 'status'],
    },
  }
  for (const [file, schemas] of Object.entries(gating)) {
    const loaded = loadSchemas(file)
    for (const [schema, fields] of Object.entries(schemas)) {
      // EVALUATED, not string-matched. Joining every `required` list in a schema and asking whether the
      // name appears anywhere was too loose in a way that produced a false PASS: `merged` is required
      // inside `subPrStates.items`, so dropping it from the TOP-LEVEL required list still satisfied the
      // text search, and the mutation that reintroduced the parking defect went unnoticed. The rule is
      // per-scope — every object declaring the field as a property must require it there.
      const literal = loaded[schema]
      assert.ok(literal, `${file}: ${schema} not found`)
      const scopes = []
      const walk = (node) => {
        if (!node || typeof node !== 'object') return
        if (node.properties) scopes.push(node)
        for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v)
      }
      walk(literal)
      assert.ok(scopes.length, `${file}: ${schema} declares no properties`)
      for (const f of fields) {
        const declaring = scopes.filter((sc) => Object.prototype.hasOwnProperty.call(sc.properties, f))
        assert.ok(declaring.length, `${file}: ${schema} no longer declares ${f} — update this invariant`)
        for (const sc of declaring) {
          assert.ok(
            (sc.required || []).includes(f),
            `${file}: ${schema}.${f} is branched on but not required in the scope that declares it — an omission would default it silently`,
          )
        }
      }
    }
  }
})

check('INVARIANT: every field the epic wake parks on is documented as one the coordinator clears', async () => {
  // The same rule the assemble-state invariant applies to `issue-multi-pr`, at the epic altitude.
  // `epic-wake` parks work on two durable human-decision fields, and neither has anything in the
  // script that can clear it — only the coordinator can, so a field the skill never tells it to
  // clear is a permanent stall however correct the script looks.
  const src = readFileSync(join(HERE, 'epic-wake.js'), 'utf8')
  const skill = readFileSync(join(HERE, '..', 'skills', 'epic-lifecycle', 'SKILL.md'), 'utf8')

  // Set by the script (so the invariant fails if a field is renamed) and cleared only outside it.
  const parksOn = {
    blocker: /remove `blocker`, so the issue resumes/,
    // The PR-feedback cap parks on a COUNTER rather than a text field, which makes it the easiest
    // one to strand: there is nothing to delete, so a coordinator that records the human's answer
    // and stops there leaves the row capped forever while believing it released it.
    prFeedbackRounds: /set `prFeedbackRounds: 0`/,
    // `unsettled` is NOT here any more, and its removal is the point. Requiring the skill to say "drop the
    // matching entry" pinned the defect this invariant's own `answers` note describes: dropping the record
    // is the coordinator's only move when the answer has no field, and it loses the decision — the
    // epic-spec and every child aligned to it never receive it. The answer goes to `epic.answers`, the
    // entry stays, and the SCRIPT retires it once the fold consumes that answer. Asserted below as a
    // script behaviour, which is where it now lives.
  }
  for (const [field, clearedBy] of Object.entries(parksOn)) {
    assert.ok(src.includes(field), `${field} is no longer set by the script — update this invariant`)
    assert.ok(clearedBy.test(skill), `the script parks on \`${field}\` but the skill never tells the coordinator to clear it`)
  }

  // `unsettled` retires inside the script, keyed on the answer being consumed — so it is bounded without
  // the coordinator deleting anything. If this filter goes, the claim is advertised forever.
  assert.match(
    src,
    /epic\.unsettled \|\| \[\]\)\]\.filter\(\(u\) => !answeredThisWake\.has\(u\.claim\)\)/,
    'the script must retire an epic unsettled record once its answer is folded',
  )

  // The MIRROR, and the defect class this file has hit most: a channel wired at one end only. A field
  // the script READS but cannot itself write is dead surface unless the skill tells the coordinator to
  // write it — and dead surface here isn't cosmetic, it silently drops whatever was supposed to travel
  // on it. `openQuestions` was this (the fold's contract said report them, the schema rejected them),
  // and `blockerResolution` is the same shape: without it the human's answer to an escalation reaches
  // nobody and the replacement worker re-escalates the identical fork forever.
  const readsButCannotWrite = {
    // The newest instance of this exact class, and the one that would have stalled every epic: the script
    // holds all implementation until `crossSpecCleared`, and nothing in the script can ever set it.
    crossSpecCleared: /Pass `crossSpecCleared` in the args, and persist it/,
    blockerResolutions: /\*\*append\*\* `\{ for, answer \}` to \*\*`blockerResolutions`\*\*/,
    approvedInSession: /record the \*\*head SHA they approved\*\* in this field/,
    // The epic-altitude twin, and the one that proves the invariant needed to exist: `openQuestions`
    // and `unsettled` were both durable, re-surfaced questions whose ANSWER had no field at all, so the
    // coordinator's only move was to drop the question — decision made, spec unchanged, no record.
    answers: /add `\{ question, answer \}` to this array/,
  }
  for (const [field, writtenBy] of Object.entries(readsButCannotWrite)) {
    assert.ok(src.includes(field), `${field} is no longer read by the script — update this invariant`)
    assert.ok(
      writtenBy.test(skill),
      `the script reads \`${field}\` but the skill never tells the coordinator to set it — a channel with only one end`,
    )
  }
})

check('INVARIANT: no assemble state is a dead end', async () => {
  const { assembleState } = loadRules('issue-multi-pr.js', ['allMerged', 'assembleState'])
  const src = readFileSync(join(HERE, 'issue-multi-pr.js'), 'utf8')

  // States that DISPATCH something, and states that WAIT. A waiting state is legitimate only if
  // it BOTH waits on a handle a human can act on AND has a path out — something that observes the
  // wait ending. GAP_BLOCKED satisfied the first test and stalled anyway, because nothing ever
  // re-read the flag it waited on; that's why "has a path out" is now its own assertion.
  const dispatching = ['NEEDS_GOAL', 'NEEDS_GAP', 'NEEDS_FIX', 'GAP_BLOCKED']
  const waitingOn = { AWAITING_FIX: 'fixPr', GAP_BLOCKED: 'fixIssue', REPAIR_BLOCKED: 'fixBlocker' }
  // How each waiting state gets unstuck. Two different mechanisms, so they are checked in two
  // different places: a state the SCRIPT re-derives must dispatch something, and a state the
  // COORDINATOR clears must be documented in the skill as a field the coordinator clears — a
  // field nobody is told to clear is a stall no matter how it reads in the script.
  const skill = readFileSync(join(HERE, '..', 'skills', 'issue-lifecycle', 'SKILL.md'), 'utf8')
  const scriptDispatches = { GAP_BLOCKED: 'label: `gap-recheck:' }
  const coordinatorClears = { AWAITING_FIX: 'fixMerged', REPAIR_BLOCKED: 'fixBlocker' }
  const terminal = ['DONE', null]

  const nodes = [{ id: 'a', dependsOn: [], status: 'merged' }]
  const space = product({
    passed: [true, false, undefined],
    failure: ['boom', undefined],
    fixIssue: ['FIX-99', null, undefined],
    fixReady: [true, false, undefined],
    fixPr: [42, null, undefined],
    fixMerged: [true, false, undefined],
    fixBlocker: ['needs a call', undefined],
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
    // And a waiting state with no way to observe the wait ending is also a stall.
    if (state in scriptDispatches) {
      assert.ok(
        src.includes(scriptDispatches[state]),
        `${state} has no path out — the script never dispatches "${scriptDispatches[state]}", so it parks forever`,
      )
    }
    if (state in coordinatorClears) {
      const field = coordinatorClears[state]
      assert.ok(
        skill.includes(field),
        `${state} waits for the coordinator to clear \`${field}\`, but the skill never tells it to — a stall`,
      )
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
    prFeedbackRounds: [0, 11, 12],
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

check('the PR-feedback cap stops feedback rounds and nothing else', async () => {
  // → orchestration.md § "PR feedback: the round cap". Three things have to hold together, and
  // the third is the one a reasonable implementation gets wrong: capping the PHASE rather than
  // the feedback dispatches strands a multi-PR issue's remaining slices for a reason that has
  // nothing to do with the review loop.
  const { atPrFeedbackCap, pendingAction, PR_FEEDBACK_CAP } = loadRules('epic-wake.js', [
    'atPrFeedbackCap',
    'PR_FEEDBACK_CAP',
    'pendingAction',
  ])

  assert.equal(PR_FEEDBACK_CAP, 12, 'the cap is documented as twelve in orchestration.md')
  assert.equal(atPrFeedbackCap(undefined), false, 'a row that has never been dispatched is not capped')
  assert.equal(atPrFeedbackCap(PR_FEEDBACK_CAP - 1), false, 'the last allowed round must still run')
  assert.equal(atPrFeedbackCap(PR_FEEDBACK_CAP), true)
  assert.equal(atPrFeedbackCap(PR_FEEDBACK_CAP + 5), true, 'past the cap stays capped — the counter only resets')

  // Every way a PR_FEEDBACK row can ask for a feedback round, refused at the cap and granted below it.
  const triggers = [
    { ciFailed: true },
    { newPrEvents: true },
    { newSpecReviewEvents: true },
    { ciFailed: true, newPrEvents: true, newSpecReviewEvents: true },
  ]
  for (const trigger of triggers) {
    const base = { id: 'FIX-2', phase: 'PR_FEEDBACK', latestActivityAt: 'now', ...trigger }
    const below = pendingAction({ ...base, prFeedbackRounds: PR_FEEDBACK_CAP - 1 })
    assert.equal(below && below.action, 'pr-feedback', `not dispatched below the cap: ${JSON.stringify(trigger)}`)
    assert.equal(
      pendingAction({ ...base, prFeedbackRounds: PR_FEEDBACK_CAP }),
      null,
      `feedback dispatched at the cap: ${JSON.stringify(trigger)}`,
    )
  }

  // ...but the DAG is not feedback. A capped multi-PR row still builds its ready slices.
  const dag = {
    id: 'FIX-2',
    phase: 'PR_FEEDBACK',
    prFeedbackRounds: PR_FEEDBACK_CAP,
    newPrEvents: true,
    latestActivityAt: 'now',
    multiPrPending: true,
    subPrs: [{ id: 'a', dependsOn: [], status: 'pending' }],
  }
  const next = pendingAction(dag)
  assert.equal(next && next.action, 'implement', 'the cap stalled a multi-PR DAG step, which is not a feedback round')
})

check('a capped row is never invited to merge while the question is unanswered', async () => {
  // The cap parks a row WITHOUT writing a `blocker` — the question is derived from the counter — so a
  // gate filter testing only the stored field saw an ordinary ready row. The result was the merge gate
  // and "we stopped, is the approach wrong?" surfaced in the same wake: an invitation to take the one
  // irreversible action while we are telling the human we have stopped. "Merge as-is" is a legitimate
  // ANSWER, and it has to arrive as their decision (which resets the counter and releases the gate next
  // wake), not as an invitation issued before they answered.
  const capped = { phase: 'PR_FEEDBACK', implPr: 9, readyToMerge: true }
  const { result } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9, prFeedbackRounds: 12 })] }),
    respond: epicResponder({
      fresh: { 'FIX-2': freshRow({ phase: 'PR_FEEDBACK', implPr: 9, readyToMerge: true }) },
      worker: { 'FIX-2': capped },
    }),
  })
  assert.deepEqual(result.gates.filter((g) => g.kind === 'merge'), [], 'a capped row was invited to merge')
  assert.ok(
    result.blockers.some((b) => b.issueId === 'FIX-2' && /PR-feedback cap reached/.test(b.blocker)),
    'withholding the gate without asking the question is a silent stall, not a fix',
  )

  // The same row below the cap keeps its gate — the withholding is the cap's, not a blanket stop.
  const { result: below } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9, prFeedbackRounds: 11 })] }),
    respond: epicResponder({
      fresh: { 'FIX-2': freshRow({ phase: 'PR_FEEDBACK', implPr: 9, readyToMerge: true }) },
      worker: { 'FIX-2': capped },
    }),
  })
  assert.deepEqual(below.gates.filter((g) => g.kind === 'merge'), [{ kind: 'merge', issueId: 'FIX-2', pr: 9 }])
})

check('the last allowed round is told the pause is conditional on it being a real round', async () => {
  // Stated unconditionally, the near-cap instruction overrode the zero-cost rule one line above it for
  // exactly the batch that rule names: an acknowledgements-only batch would report 1 and post a pause
  // comment, parking the issue at a twelfth round nobody spent and claiming twelve handled rounds on
  // someone's PR.
  const { calls } = await run('epic-wake.js', {
    args: epicArgs({ issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 9, prFeedbackRounds: 11 })] }),
    respond: epicResponder({ fresh: { 'FIX-2': freshRow({ phase: 'PR_FEEDBACK', implPr: 9, newPrEvents: true }) } }),
  })
  const prompt = (calls.find((c) => (c.label || '') === 'pr-feedback:FIX-2') || {}).prompt || ''
  assert.ok(prompt, 'the near-cap round must still be dispatched — the cap is at 12, not 11')
  assert.match(prompt, /IF this batch is a real round/, 'the pause must be conditional, not forced')
  assert.match(prompt, /report 0 as above and post NO pause comment/, 'the zero-cost escape must survive the cap warning')
  assert.doesNotMatch(prompt, /Report `prFeedbackRoundsSpent: 1`/, 'the count must not be forced ahead of reading the batch')
})

check('the PR-feedback counter charges rounds the way the cap needs', async () => {
  // The counter IS the cap's mechanism — there is no separate flag — so each of these rules is
  // load-bearing on its own. An unreported round charged zero makes the cap unreachable; an
  // escalating worker charged one trips it a round early on a batch it never finished reading.
  const { nextRow } = loadRules('epic-wake.js', [
    'atReviewBudget',
    'atPrFeedbackCap',
    'pendingAction',
    'CONSUMES_REVIEW_ACTIVITY',
    'nextRow',
  ])
  const row = { id: 'FIX-2', phase: 'PR_FEEDBACK', prFeedbackRounds: 4 }
  const ran = (worker, action = 'pr-feedback') => nextRow(row, { worker, action, landed: [], folded: false })
  const done = (over = {}) => ({ issueId: 'FIX-2', phase: 'PR_FEEDBACK', ...over })

  assert.equal(ran(done()).prFeedbackRounds, 5, 'an unreported round must be charged one, or the cap is unreachable')
  assert.equal(ran(done({ prFeedbackRoundsSpent: 1 })).prFeedbackRounds, 5)
  assert.equal(
    ran(done({ prFeedbackRoundsSpent: 0 })).prFeedbackRounds,
    4,
    'a batch of pure acknowledgements says so explicitly and must be honoured',
  )
  assert.equal(
    ran(done({ blocker: 'needs a call' })).prFeedbackRounds,
    4,
    'a worker that escalated did not finish the round — same rule as the cursor it also holds',
  )
  assert.equal(ran(done(), 'implement').prFeedbackRounds, 4, 'only a feedback dispatch is charged by default')

  // ...and a count REPORTED by a non-feedback action is ignored, not added. One WORKER_SCHEMA serves
  // every action, so both count fields are permitted on all of them while no prompt asks for them
  // outside a review or feedback dispatch. Taking the reported value let a DAG build or a decision
  // application charge rounds nobody dispatched, walking an issue to a cap that only feedback handling
  // is supposed to be able to reach. The action decides; the report only sizes a round it authorized.
  for (const action of ['implement', 'apply-verdict', 'apply-decision', 'spec']) {
    assert.equal(
      ran(done({ prFeedbackRoundsSpent: 3 }), action).prFeedbackRounds,
      4,
      `a ${action} dispatch charged the feedback cap`,
    )
    assert.equal(
      ran(done({ specReviewRoundsSpent: 3 }), action).specReviewRounds,
      row.specReviewRounds || 0,
      `a ${action} dispatch charged the spec budget`,
    )
  }
  assert.equal(ran(undefined).prFeedbackRounds, 4, 'a dead worker mutates nothing beyond its cursor — the count is carried, not charged')

  // A round is BOOLEAN: one dispatch is one pass over the outstanding batch, so the report says
  // WHETHER this was a round and can never size it. `number` in the schema accepts anything an agent
  // emits — a feedback worker that touched three sub-PR handles reporting `3` is a reading the
  // multi-PR prompt invites — and adding that verbatim caps the issue after four dispatches. A
  // negative is worse: it walks the counter backward, past a cap that has to stay reachable.
  for (const [reported, charged] of [
    [1, 1],
    [2, 1],
    [3, 1],
    [12, 1],
    [0.5, 1],
    [0, 0],
    [-1, 0],
    [-99, 0],
  ]) {
    assert.equal(
      ran(done({ prFeedbackRoundsSpent: reported })).prFeedbackRounds,
      4 + charged,
      `a worker reporting ${reported} charged something other than ${charged}`,
    )
    assert.equal(
      ran(done({ specReviewRoundsSpent: reported }), 'spec-review').specReviewRounds,
      (row.specReviewRounds || 0) + charged,
      `the spec budget took ${reported} verbatim`,
    )
  }

  // The reset is the coordinator's, so nothing in the script may ever lower either count.
  for (const spent of [undefined, 0, 1, 5, -3]) {
    const out = ran(done(spent === undefined ? {} : { prFeedbackRoundsSpent: spent }))
    assert.ok(out.prFeedbackRounds >= row.prFeedbackRounds, `the script lowered the counter (spent=${spent})`)
  }
})

check('a capped row is surfaced to the human and holds the epic open', async () => {
  // The cap's blocker is DERIVED from the counter rather than stored, so this is what proves the
  // question actually reaches the human — and that an epic cannot wrap over a review loop we
  // stopped without an answer.
  const { result: res } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 71, prFeedbackRounds: 12, newPrEvents: true })],
    }),
    respond: epicResponder({ fresh: { 'FIX-2': freshRow({ phase: 'PR_FEEDBACK', newPrEvents: true }) } }),
  })

  assert.equal(res.dispatched.length, 0, 'a capped row must dispatch no feedback worker')
  const surfaced = res.blockers.find((b) => b.issueId === 'FIX-2')
  assert.ok(surfaced, 'the cap was reached and nobody was told — a silent stop')
  assert.match(surfaced.blocker, /PR-feedback cap reached/)
  assert.match(surfaced.blocker, /12 rounds/, 'the human needs the count to decide')
  assert.equal(res.mayWrap, false, 'the epic wrapped over an unanswered question')

  // ...and the answer releases it: the coordinator resets the counter, and the row runs again.
  const { result: resumed } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 71, prFeedbackRounds: 0, newPrEvents: true })],
    }),
    respond: epicResponder({ fresh: { 'FIX-2': freshRow({ phase: 'PR_FEEDBACK', newPrEvents: true }) } }),
  })
  assert.deepEqual(resumed.dispatched, ['pr-feedback:FIX-2'], 'resetting the counter must un-park the row')
  assert.equal(resumed.blockers.length, 0)

  // ...and work that no longer exists asks nothing. A cancelled row keeps its phase and its count,
  // so without this the epic holds open on a question nobody can answer.
  const { result: cancelled } = await run('epic-wake.js', {
    args: epicArgs({
      issues: [row('FIX-2', { phase: 'PR_FEEDBACK', implPr: 71, prFeedbackRounds: 12 })],
    }),
    respond: epicResponder({
      fresh: { 'FIX-2': freshRow({ phase: 'PR_FEEDBACK' }) },
      linear: { 'FIX-2': { state: 'Canceled', blockedBy: [] } },
    }),
  })
  assert.equal(cancelled.blockers.length, 0, 'a cancelled issue asked the human about work that no longer exists')
  assert.equal(cancelled.mayWrap, true, 'the epic could not wrap over a cancelled capped row')
})

check('INVARIANT: an agent-reported id never decides which row a result lands on', async () => {
  // The generalized form of the defect review found in the refresh scan, and which was also
  // present in the worker map and the settle-request attribution. `issueId` is a free-form string
  // in every schema, so ANY code path that keys on the reported value can move one issue's read
  // onto another row — and the reads that matter are the gates. Rather than assert the three known
  // call sites, drive the whole wake with every agent lying about its identity and require that no
  // gating field can be set, and no gate surfaced, from a foreign read.
  const ids = ['FIX-2', 'FIX-3', 'FIX-4']
  // Each row gets a distinguishable handle, so a misattributed response is visible even when it
  // carries no gating field at all.
  const ownPr = { 'FIX-2': 72, 'FIX-3': 73, 'FIX-4': 74 }
  let lied = 0

  for (const liar of ids) {
    for (const claimed of ids.filter((i) => i !== liar)) {
      for (const kind of ['refresh', 'worker']) {
        // The row shape has to actually DISPATCH for the worker path to exist: a row parked at
        // AWAITING_SPEC_APPROVAL with no approval and no new events returns no action, which is
        // how an earlier version of this invariant passed while the defect was still present.
        const phase = kind === 'refresh' ? 'AWAITING_SPEC_APPROVAL' : 'NEEDS_SPEC'
        const { result } = await run('epic-wake.js', {
          args: epicArgs({ issues: ids.map((id) => row(id, { phase, specPr: ownPr[id] })) }),
          respond: (prompt, opts) => {
            const label = opts.label || ''
            if (label === 'gate:epic') return { approved: true, approvedByLabel: false, headSha: 'abc', newReviewEvents: false, latestActivityAt: '2026-07-05T00:00:00Z' }
            if (label === 'linear:epic-children') return { issues: [] }
            if (label.startsWith('refresh:')) {
              const self = label.slice('refresh:'.length)
              const lying = kind === 'refresh' && self === liar
              // The dangerous payload: an approval, and a merge-ready PR, attributed elsewhere.
              return {
                issueId: lying ? claimed : self,
                ...freshRow({ phase, specApproved: lying, readyToMerge: lying, specPr: ownPr[self] }),
              }
            }
            const self = label.split(':')[1]
            const lying = kind === 'worker' && self === liar
            return workerRes({ issueId: lying ? claimed : self, phase, readyToMerge: lying, specPr: ownPr[self] })
          },
        })
        lied++
        assert.ok(result.issues.length === ids.length)

        for (const r of result.issues) {
          assert.equal(r.specApproved, false, `${r.id} took an approval from ${liar}'s response (${kind})`)
          assert.equal(r.readyToMerge, false, `${r.id} took merge-readiness from ${liar}'s response (${kind})`)
          // A discarded response leaves the carried handle; it must never be replaced by another
          // row's. Either the row's own value or nothing — never a sibling's.
          assert.equal(r.specPr, ownPr[r.id], `${r.id} took a handle belonging to another row (${kind}, ${liar}→${claimed})`)
        }
        assert.deepEqual(
          result.gates.filter((g) => g.kind !== 'spec-approval'),
          [],
          `a foreign ${kind} response surfaced a gate: ${JSON.stringify(result.gates)}`,
        )
      }
    }
  }
  assert.equal(lied, 12)
})

check('INVARIANT: the activity cursor never advances past unconsumed activity', async () => {
  // `consumesReviewActivity` is loaded, not restated. Which actions read a review batch is exactly
  // the kind of rule that grows an exception (the approval transition did), and an invariant that
  // hard-codes its own copy stops testing the code the moment the code changes — it just fails, or
  // worse, keeps passing against a rule nobody follows any more.
  const { nextRow, consumesReviewActivity } = loadRules('epic-wake.js', [
    'atReviewBudget',
    'pendingAction',
    'CONSUMES_REVIEW_ACTIVITY',
    'consumesReviewActivity',
    'nextRow',
  ])
  const actions = [undefined, 'spec', 'spec-review', 'implement', 'pr-feedback', 'apply-verdict']
  let cases = 0

  for (const action of actions) {
    for (const workerReturned of [true, false]) {
      for (const workerBlocked of [true, false]) {
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
            const worker = workerReturned
              ? { issueId: 'FIX-2', phase: 'AWAITING_SPEC_APPROVAL', ...(workerBlocked ? { blocker: 'needs a call' } : {}) }
              : undefined
            const out = nextRow(row, { worker, action, landed: [], folded: false })
            const advanced = out.lastSeenActivityAt === 'new'
            const hadActivity = newSpecReviewEvents || newPrEvents
            // A worker that escalated did not finish reading the batch, so it consumes nothing.
            const consumed = workerReturned && !workerBlocked && consumesReviewActivity(action, row)
            cases++
            assert.equal(
              advanced,
              !hadActivity || consumed,
              `cursor advanced=${advanced} for action=${action} worker=${workerReturned} blocked=${workerBlocked} activity=${hadActivity}`,
            )
          }
        }
      }
    }
  }
  assert.equal(cases, 96)
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

