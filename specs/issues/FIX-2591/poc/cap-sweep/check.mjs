#!/usr/bin/env node
/**
 * FIX-2591 cap sweep — throwaway spec evidence, not production code.
 *
 * Scans every tracked text file for the phrasings of the epic cap ("at most two epics active")
 * and classifies each hit as exactly one of:
 *   - cap        a living doc or skill that states or enforces the epic cap  → must be zero when done
 *   - otherAxis  the same words about something else (worker concurrency, project-branch collisions…)
 *   - history    retained specs and dated records, left as written (DECISIONS.md D3)
 * Anything not allowlisted as otherAxis or history is a cap hit, so an unlisted mention fails closed.
 *
 * It also asserts the per-wake worker cap is still present (DECISIONS.md D2).
 *
 *   node specs/issues/FIX-2591/poc/cap-sweep/check.mjs            # exit 1 while any cap hit remains
 *   node specs/issues/FIX-2591/poc/cap-sweep/check.mjs --control  # plants a cap line; must report it
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
process.chdir(root)

const PATTERN =
  /two epics|cap is two|active epics|held, not cancelled|hold this outcome|wrap another|epics run at once|how many epics run|how-many-epics|epic slot|slot frees|frees the slot|cap at two|cap lives on epics|caps? concurrent epics|third epic|two active|active-epic|cap is on objectives|epic cap|→ cap →|cap \(skip/i

const TEXT = /\.(md|mjs|js|ts|tsx|yml|yaml|json)$/

/** Retained specs and dated records: design history, never rewritten. */
const HISTORY = [
  /^specs\//,
  /^docs\/internal\/(?!4dx-process\.md$)/, // dated reviews, ledgers, archive, wraps; 4dx-process.md is living
  /CHANGELOG\.md$/,
]

/** Same words, different subject. Each entry is path + the line text it is allowed to match. */
const OTHER_AXIS = [
  { path: /^packages\/harness-manager\//, line: /two epics/i, why: 'two epics driving one issue-phase get separate checkouts' },
  { path: /^packages\/core\/test\//, line: /two active edges/i, why: 'graph edge cap in a unit test' },
  { path: /^docs\/contributing\/project-spec-template\.md$/, line: /two epics|two concurrent epics/i, why: 'project-spec figure triggers and branch collisions' },
  { path: /^docs\/contributing\/orchestration\.md$/, line: /^### Two epics under one project: skip, don't queue$/, why: 'project-branch collision section heading' },
  { path: /^\.agents\/skills\/project-spec\/SKILL\.md$/, line: /Two epics may run under one project/, why: 'project-branch collision' },
  { path: /^\.agents\/subagents\/project-agent\.md$/, line: /Two epics may run under one project/, why: 'project-branch collision' },
  { path: /^\.agents\/skills\/agent-mailbox\/SKILL\.md$/, line: /two epics under `fsd-head-of-engineering`/, why: 'session labels' },
  { path: /^\.agents\/skills\/epic-lifecycle\/SKILL\.md$/, line: /Over the cap → queue it; admit it when a slot frees/, why: 'per-wake worker concurrency cap' },
  { path: /^\.agents\/workflows\/verify\.mjs$/, line: /epic cap/, why: 'the per-wake worker cap passed into issue-multi-pr (`cap: 2`)' },
  { path: /^\.agents\/workflows\/verify\.mjs$/, line: /third epic round/, why: 'the third spec-review round on an epic' },
  { path: /^apps\/docs\/docs\/orchestration\/task-board\.md$/, line: /frees the slot again/, why: 'task-board maxInstances slot (user docs)' },
]

/** The per-wake worker cap must survive (D2). */
const KEPT = [
  { path: '.agents/skills/epic-lifecycle/SKILL.md', text: /Sizing to the VM/ },
  { path: '.agents/skills/epic-lifecycle/SKILL.md', text: /cap:\s+<the N you chose and stated>/ },
  { path: '.agents/workflows/epic-wake.js', text: /\bcap\b/ },
]

const SELF = 'specs/issues/FIX-2591/'

function scan(extra = []) {
  const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter((f) => TEXT.test(f))
  const hits = { cap: [], otherAxis: [], history: [] }
  const lines = []
  for (const f of files) {
    if (f.startsWith(SELF)) continue // this spec quotes the phrasings on purpose
    readFileSync(f, 'utf8').split('\n').forEach((text, i) => lines.push({ f, n: i + 1, text }))
  }
  lines.push(...extra)
  for (const { f, n, text } of lines) {
    if (!PATTERN.test(text)) continue
    const at = `${f}:${n}: ${text.trim().slice(0, 110)}`
    if (HISTORY.some((re) => re.test(f))) hits.history.push(at)
    else if (OTHER_AXIS.some((o) => o.path.test(f) && o.line.test(text))) hits.otherAxis.push(at)
    else hits.cap.push(at)
  }
  return { hits, files: files.length }
}

function keptProblems() {
  return KEPT.filter((k) => !k.text.test(readFileSync(k.path, 'utf8'))).map((k) => `${k.path} lost ${k.text}`)
}

if (process.argv.includes('--control')) {
  // Plant a cap line in a living doc that also carries an allowlisted heading: the allowlist must not absorb it.
  const planted = { f: 'docs/contributing/orchestration.md', n: 0, text: 'The cap allows two active epics.' }
  const { hits } = scan([planted])
  const caught = hits.cap.some((h) => h.includes('The cap allows two active epics.'))
  console.log(caught ? 'control: PASS (planted cap line reported as cap)' : 'control: FAIL (planted line was absorbed)')
  process.exit(caught ? 0 : 1)
}

const { hits, files } = scan()
const lost = keptProblems()
console.log(`scanned ${files} tracked text files`)
for (const k of ['cap', 'otherAxis', 'history']) {
  const fileCount = new Set(hits[k].map((h) => h.slice(0, h.indexOf(':')))).size
  console.log(`\n${k}: ${hits[k].length} lines in ${fileCount} files`)
  for (const h of hits[k]) console.log(`  ${h}`)
}
console.log(`\nworker cap kept: ${lost.length === 0 ? 'yes' : 'NO — ' + lost.join('; ')}`)
const ok = hits.cap.length === 0 && lost.length === 0
console.log(ok ? '\nRESULT: PASS — no living doc states or enforces an epic cap' : `\nRESULT: FAIL — ${hits.cap.length} cap mention(s) remain in ${new Set(hits.cap.map((h) => h.slice(0, h.indexOf(':')))).size} file(s)`)
process.exit(ok ? 0 : 1)
