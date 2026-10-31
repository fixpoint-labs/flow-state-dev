/**
 * app-review — the fan-out half of the `app-review` skill, as deterministic control flow.
 *
 * NOT RUNNABLE STANDALONE. This is a Claude Code **Workflow script**: the harness injects
 * `agent` / `parallel` / `pipeline` / `log` / `phase` / `args` as globals and wraps the body in
 * an async function, so the top-level `return` is legal here. Contract:
 * `docs/contributing/orchestration.md` → "The workflow-script contract"; `verify.mjs` tests it.
 *
 * Shape: one LEAD per app (maps the app into a brief) → N LENS sub-agents per app (find
 * improvements through one lens each, grounded in code) → one SYNTHESIZER across every app
 * (spot-checks, merges overlaps, assigns each item a home: foundation package, workforce, or the
 * app). Pipelined per app, so one app's lenses start as soon as its lead returns. The only
 * barrier is the synthesizer, which genuinely needs every app's findings at once.
 *
 * Two modes, picked by `args.prior`:
 *   - fresh: the synthesizer returns the full item list (`items`).
 *   - fold:  a prior run's report data exists (`args.prior.itemsFile`, a path the agents READ;
 *            a script can't). Lens agents tag findings that match a prior item, and the
 *            synthesizer returns `updates` to prior items plus `newItems`, never a rewrite of
 *            the prior list. The skill's `build-report.mjs` merges them deterministically.
 *
 * What it does NOT do (the skill's job, because a script can't): ask the user anything, read or
 * write files, build or publish the report.
 */

export const meta = {
  name: 'app-review',
  description:
    'Review apps built on FSD: a lead per app, lens sub-agents per app, then one synthesizer that finds overlaps and decides which package or app owns each improvement.',
  whenToUse:
    'Dispatched by the app-review skill with args { apps, focus, lenses?, minPerLens?, prior?, runTag?, extraContext? }. Not run standalone.',
  phases: [
    { title: 'Map', detail: 'one lead agent per app builds an app brief' },
    { title: 'Find', detail: 'lens sub-agents per app find improvements' },
    { title: 'Synthesize', detail: 'merge overlaps, decide each item’s home' },
  ],
}

// The Workflow tool delivers `args` as a JSON string; ad-hoc runs may pass an object.
const A = typeof args === 'string' ? JSON.parse(args) : args || {}
if (!Array.isArray(A.apps) || A.apps.length === 0) throw new Error('app-review: args.apps must list at least one app')

const DEFAULT_LENSES = [
  {
    key: 'usability',
    prompt:
      'LENS: usability and overall user experience. Navigation, discoverability, feedback and status clarity, empty/error/loading states, keyboard flow, accessibility, information density, consistency, first run, and how legible long-running and background work is.',
  },
  {
    key: 'doing-work',
    prompt:
      'LENS: features that let someone actually CONDUCT REAL WORK and DEVELOP ON THIS CODEBASE (flow-state-dev itself) through the app: reviewing code changes, branches and PRs, running checks, linking Linear issues, handing off and resuming work, approvals, attaching context, harness choice, cost and time visibility. What blocks using it as a daily driver?',
  },
  {
    key: 'robustness',
    prompt:
      'LENS: reliability, session and state management, and observability as the user experiences them. Reconnect/resume after reload or restart, stuck or failed work and recovery, concurrency, long conversations, persistence, setup friction, debuggability (traces, DevTool links), and test coverage of user-facing behaviour.',
  },
]
const LENSES = Array.isArray(A.lenses) && A.lenses.length ? A.lenses : DEFAULT_LENSES
const MIN = Number.isInteger(A.minPerLens) && A.minPerLens > 0 ? A.minPerLens : 5
// Finding ids must be unique across runs: a fold run that re-reviews an app would otherwise mint
// the same ids as the earlier run, and earlier items would cite unrelated new findings.
// The skill passes a fresh `runTag` (e.g. "r2") on every fold run.
const TAG = typeof A.runTag === 'string' && /^[A-Za-z0-9]+$/.test(A.runTag) ? `${A.runTag.toUpperCase()}-` : ''
const FOLD = !!(A.prior && A.prior.itemsFile)
// Fold-mode items may name apps from the prior run too (args.prior.apps), not only this run's.
const APP_KEYS = [...new Set([...A.apps.map((a) => a.key), ...((FOLD && A.prior.apps) || [])])]

const COMMON = `Repo: the flow-state-dev monorepo (your working directory). READ-ONLY research: do not edit files, commit, or push, and do not start servers that need API keys. Ground every claim in files you actually read and cite repo-relative paths with line numbers where you can.${A.extraContext ? `\n\nCONTEXT FROM THE COORDINATOR:\n${A.extraContext}` : ''}${A.focus ? `\n\nTHE USER'S FOCUS FOR THIS REVIEW (weight your work toward it; it outranks the generic lens text where they differ):\n${A.focus}` : ''}`

const PRIOR_NOTE = FOLD
  ? `\n\nA PRIOR REVIEW produced items in ${A.prior.itemsFile} (JSON; each item has id, title, apps, home, problem). Read it. When a finding of yours is the same underlying need as a prior item, set matchesExisting to that id and still report it with THIS app's evidence: overlap is the point. Don't force a match.`
  : ''

const BRIEF_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'What the app is, how it is structured, how a user runs and uses it (≤250 words)' },
    architecture: { type: 'string', description: 'Key files, workers, flows, UI components; which framework packages it leans on and how it reads live data (≤300 words)' },
    knownGaps: { type: 'array', items: { type: 'string' } },
    userJourneys: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'architecture', 'knownGaps', 'userJourneys'],
}

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          problem: { type: 'string', description: 'What is wrong or missing today, from the user’s point of view' },
          proposal: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
          impact: { type: 'integer', minimum: 1, maximum: 5 },
          effort: { type: 'string', enum: ['S', 'M', 'L'] },
          likelyLayer: { type: 'string', description: 'Your guess: app-only, workforce, orchestration, react/ui/client, core/engine, harness-manager, other' },
          matchesExisting: { type: 'string', description: 'Prior item id this is the same need as, or empty string' },
        },
        required: ['title', 'problem', 'proposal', 'evidence', 'impact', 'effort', 'likelyLayer', 'matchesExisting'],
      },
    },
  },
  required: ['findings'],
}

const ITEM_PROPS = {
  id: { type: 'string' },
  title: { type: 'string' },
  theme: { type: 'string' },
  apps: { type: 'array', items: { type: 'string', enum: APP_KEYS } },
  home: { type: 'string', enum: ['foundation', 'workforce', 'app'] },
  package: { type: 'string', description: 'Concrete target package(s) or app dir(s)' },
  rationale: { type: 'string', description: 'Why this home' },
  problem: { type: 'string' },
  proposal: { type: 'string' },
  impact: { type: 'integer', minimum: 1, maximum: 5 },
  effort: { type: 'string', enum: ['S', 'M', 'L'] },
  priority: { type: 'string', enum: ['P1', 'P2', 'P3'] },
  sourceFindings: { type: 'array', items: { type: 'string' } },
  evidence: { type: 'array', items: { type: 'string' } },
}
const ITEM_SCHEMA = { type: 'object', properties: ITEM_PROPS, required: Object.keys(ITEM_PROPS) }
const THEME_SCHEMA = {
  type: 'object',
  properties: { name: { type: 'string' }, description: { type: 'string' } },
  required: ['name', 'description'],
}
const REJECT_SCHEMA = {
  type: 'object',
  properties: { findingId: { type: 'string' }, reason: { type: 'string' } },
  required: ['findingId', 'reason'],
}
const UPDATE_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    addApps: { type: 'array', items: { type: 'string', enum: APP_KEYS } },
    addSourceFindings: { type: 'array', items: { type: 'string' } },
    addEvidence: { type: 'array', items: { type: 'string' } },
    note: { type: 'string', description: 'How the need shows up in the newly added app(s)' },
    newHome: { type: 'string', enum: ['', 'foundation', 'workforce', 'app'] },
    newPackage: { type: 'string' },
    homeChangeReason: { type: 'string' },
    newPriority: { type: 'string', enum: ['', 'P1', 'P2', 'P3'] },
  },
  required: ['id', 'addApps', 'addSourceFindings', 'addEvidence', 'note', 'newHome', 'newPackage', 'homeChangeReason', 'newPriority'],
}
const SYNTH_SCHEMA = FOLD
  ? {
      type: 'object',
      properties: {
        executiveSummary: { type: 'string' },
        updates: { type: 'array', items: UPDATE_SCHEMA },
        newItems: { type: 'array', items: ITEM_SCHEMA },
        newThemes: { type: 'array', items: THEME_SCHEMA },
        rejected: { type: 'array', items: REJECT_SCHEMA },
      },
      required: ['executiveSummary', 'updates', 'newItems', 'newThemes', 'rejected'],
    }
  : {
      type: 'object',
      properties: {
        executiveSummary: { type: 'string' },
        themes: { type: 'array', items: THEME_SCHEMA },
        items: { type: 'array', items: ITEM_SCHEMA },
        rejected: { type: 'array', items: REJECT_SCHEMA },
      },
      required: ['executiveSummary', 'themes', 'items', 'rejected'],
    }

const lensTag = (l) => l.key.replace(/[^a-z]/gi, '').slice(0, 3).toUpperCase()

const results = await pipeline(
  A.apps,
  (app) =>
    agent(
      `${COMMON}

You are the LEAD AGENT for ${app.name} at ${app.dir}${app.about ? `: ${app.about}` : '.'}
Read its README(s), any CLAUDE.md, its source, tests, and the specs its docs link. Produce a precise brief that other agents will use to find improvements. Be concrete: name files, workers, flows and components.`,
      { label: `lead:${app.key}`, phase: 'Map', schema: BRIEF_SCHEMA },
    ),
  (brief, app) => {
    // A dead lead is infrastructure failure: drop the app (pipeline turns the throw into null)
    // rather than sending lens agents off without a brief.
    if (!brief) throw new Error(`lead for ${app.key} returned nothing`)
    return parallel(
      LENSES.map((l) => () =>
        agent(
          `${COMMON}

You are a sub-agent of the lead for ${app.name} (${app.dir}).

LEAD'S BRIEF:
${JSON.stringify(brief, null, 2)}

${l.prompt}${PRIOR_NOTE}

Find AT LEAST ${MIN} distinct, high-value improvements under your lens, each grounded in code you read (cite paths). Don't restate a gap the brief lists as already planned unless you sharpen it into a concrete proposal. No generic advice. Rate impact 1-5 for a developer using this app daily.`,
          { label: `${l.key}:${app.key}`, phase: 'Find', schema: FINDINGS_SCHEMA },
        ),
      ),
    ).then((rs) => ({
      app: app.key,
      name: app.name,
      dir: app.dir,
      brief,
      findings: rs.flatMap((r, li) =>
        r ? r.findings.map((f, i) => ({ ...f, lens: LENSES[li].key, id: `${app.prefix}-${TAG}${lensTag(LENSES[li])}-${i + 1}` })) : [],
      ),
      deadLenses: rs.map((r, li) => (r ? null : LENSES[li].key)).filter(Boolean),
    }))
  },
)

const ok = results.filter(Boolean)
const lost = A.apps.filter((a) => !ok.some((r) => r.app === a.key)).map((a) => a.key)
for (const r of ok) {
  log(`${r.app}: ${r.findings.length} findings${r.deadLenses.length ? ` (lens agents lost: ${r.deadLenses.join(', ')})` : ''}`)
}
if (lost.length) log(`apps with no result (lead died): ${lost.join(', ')}`)
if (!ok.some((r) => r.findings.length)) return { apps: ok, lost, synth: null }

phase('Synthesize')
const HOME_RULES = `Decide the HOME of each item: "foundation" (a framework package; name which: core, engine, client, react, ui, orchestration, harness-manager, devtool, tools…), "workforce" (@flow-state-dev/workforce), or "app" (inside the app). Reusable concepts any app on these packages needs belong in a package; app-specific layout, copy and look stay in the app. Read the candidate package's README before assigning, to check what it already owns. When one app already solves something others re-implement, that is a candidate to lift into a package. When a package already ships the thing and apps just don't use it, the home is "app" (adopt it) and the rationale names the package piece.`

const synthPrompt = FOLD
  ? `${COMMON}

You are the REVIEWER/SYNTHESIZER. Read the PRIOR items and themes in ${A.prior.itemsFile} first. Below are new app briefs and findings.

${JSON.stringify(ok, null, 1)}

1. Spot-check claims against the code (open cited files for anything surprising or high-impact). Reject findings that are wrong or already shipped, with a reason.
2. For each finding that is the same need as a prior item (lens agents suggested matchesExisting; verify it and find the matches they missed), emit an UPDATE adding the app(s), finding ids and evidence. If the wider overlap changes where it should be built, set newHome/newPackage with a reason; raise priority if the overlap warrants it.
3. Merge the remaining findings into NEW ITEMS with ids continuing after the highest prior id. List every app that needs each one (any of: ${APP_KEYS.join(', ')}).
4. ${HOME_RULES}
Every non-rejected finding must appear in an update or a new item. Use prior themes where they fit; add newThemes only if needed. Don't state totals in the summary you haven't counted.`
  : `${COMMON}

You are the REVIEWER/SYNTHESIZER. Below are app briefs and raw findings for: ${APP_KEYS.join(', ')}.

${JSON.stringify(ok, null, 1)}

1. Spot-check claims against the code (open cited files for anything surprising or high-impact). Reject findings that are wrong or already shipped, with a reason.
2. Merge duplicates and find OVERLAPS: the same underlying need in several apps (even under different names) becomes ONE item whose apps lists every app that needs it.
3. ${HOME_RULES}
4. Group into 4-8 themes and assign P1/P2/P3 (P1 = highest value against the user's focus). Ids R-01, R-02, ….
Every non-rejected finding must appear in some item's sourceFindings. Write problem and proposal in plain, concise language. Don't state totals in the summary you haven't counted.`

const synth = await agent(synthPrompt, { label: 'synthesizer', phase: 'Synthesize', schema: SYNTH_SCHEMA })
if (!synth) log('synthesizer returned nothing; findings are in apps[]')

return { mode: FOLD ? 'fold' : 'fresh', apps: ok, lost, synth }
