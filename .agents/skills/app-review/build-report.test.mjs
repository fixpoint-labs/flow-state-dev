/**
 * Evidence path for build-report.mjs (BP-003): the fold merge, its loss checks, and the
 * extract round-trip. No agents, no network.   node .agents/skills/app-review/build-report.test.mjs
 */
import assert from 'node:assert/strict'
import { merge, render, extract } from './build-report.mjs'

const brief = { summary: 's', architecture: 'a', knownGaps: [], userJourneys: [] }
const finding = (id) => ({ id, title: 't', problem: 'p', proposal: 'q', evidence: [], impact: 3, effort: 'S', likelyLayer: 'x', matchesExisting: '', lens: 'usability' })
const item = (id, apps, home, sourceFindings) => ({ id, title: `title ${id}`, theme: 'T', apps, home, package: 'p', rationale: 'r', problem: 'p', proposal: 'q', impact: 3, effort: 'S', priority: 'P2', sourceFindings, evidence: [] })

// Fresh run: two apps, one shared item, one rejected finding.
const fresh = {
  mode: 'fresh',
  apps: [
    { app: 'alpha', name: 'Alpha', dir: 'labs/alpha', brief, findings: [finding('AL-USA-1'), finding('AL-USA-2')] },
    { app: 'beta', name: 'Beta', dir: 'labs/beta', brief, findings: [finding('BE-USA-1')] },
  ],
  synth: { executiveSummary: 'first', themes: [{ name: 'T', description: 'd' }], items: [item('R-01', ['alpha', 'beta'], 'app', ['AL-USA-1', 'BE-USA-1'])], rejected: [{ findingId: 'AL-USA-2', reason: 'shipped' }] },
}
const one = merge(fresh, null, { title: 'Map', date: '2026-10-31' })
assert.deepEqual(one.problems, [])
assert.equal(one.data.runs.length, 1)

// Fold run: a third app updates R-01 (moving its home) and adds R-02.
const fold = {
  mode: 'fold',
  apps: [{ app: 'gamma', name: 'Gamma', dir: 'apps/gamma', brief, findings: [finding('GA-USA-1'), finding('GA-USA-2')] }],
  synth: {
    executiveSummary: 'second',
    updates: [{ id: 'R-01', addApps: ['gamma'], addSourceFindings: ['GA-USA-1'], addEvidence: ['apps/gamma/x.ts:1'], note: 'gamma too', newHome: 'foundation', newPackage: '@flow-state-dev/client', homeChangeReason: 'three apps', newPriority: 'P1' }],
    newItems: [item('R-02', ['gamma', 'alpha'], 'app', ['GA-USA-2'])],
    newThemes: [],
    rejected: [],
  },
}
const two = merge(fold, one.data, { date: '2026-11-01' })
assert.deepEqual(two.problems, [])
const r1 = two.data.items.find((i) => i.id === 'R-01')
assert.deepEqual(r1.apps, ['alpha', 'beta', 'gamma'])
assert.equal(r1.home, 'foundation')
assert.deepEqual(r1.homeChange, { from: 'app', fromPackage: 'p', reason: 'three apps' })
assert.equal(r1.priority, 'P1')
assert.equal(r1.notes.length, 1)
assert.equal(one.data.items[0].home, 'app', 'the prior data is not mutated')
assert.ok(two.data.items.find((i) => i.id === 'R-02').isNew)
assert.deepEqual(two.data.apps.map((a) => a.key), ['alpha', 'beta', 'gamma'])
assert.equal(two.data.runs.length, 2)
assert.equal(two.data.title, 'Map', 'the title carries over')

// Loss checks: a finding in nothing, an update to a missing item, an unknown app.
const lossy = structuredClone(fold)
lossy.apps[0].findings.push(finding('GA-USA-9'))
lossy.synth.updates.push({ ...fold.synth.updates[0], id: 'R-99' })
lossy.synth.newItems.push(item('R-03', ['delta'], 'app', []))
const bad = merge(lossy, one.data, {}).problems.join('\n')
assert.match(bad, /GA-USA-9 is in no item/)
assert.match(bad, /unknown item R-99/)
assert.match(bad, /unknown app delta/)
assert.throws(() => merge(fold, null, {}), /needs --prior/)

// Re-reviewing an app in a fold keeps its earlier findings, which earlier items cite.
const again = {
  mode: 'fold',
  apps: [{ app: 'alpha', name: 'Alpha', dir: 'labs/alpha', brief: { ...brief, summary: 'new brief' }, findings: [finding('AL-R2-USA-1')] }],
  synth: { executiveSummary: 'third', updates: [{ ...fold.synth.updates[0], id: 'R-02', addApps: ['alpha'], addSourceFindings: ['AL-R2-USA-1'], newHome: '', newPackage: '', newPriority: '' }], newItems: [], newThemes: [], rejected: [] },
}
const three = merge(again, two.data, {})
assert.deepEqual(three.problems, [])
const alpha = three.data.apps.find((a) => a.key === 'alpha')
assert.deepEqual(alpha.findings.map((f) => f.id), ['AL-USA-1', 'AL-USA-2', 'AL-R2-USA-1'], 'earlier findings survive a re-review')
assert.equal(alpha.brief.summary, 'new brief')
assert.ok(!three.data.items.find((i) => i.id === 'R-02').isNew, 'an item new in run 2 is not "new" in run 3')

// Two findings with the same id in one run would shadow each other, so they are a problem too.
const twin = structuredClone(fold)
twin.apps[0].findings.push(finding('GA-USA-1'))
assert.match(merge(twin, one.data, {}).problems.join('\n'), /GA-USA-1 appears twice in this run/)

// …and a re-review that reuses an earlier id is caught, even when an earlier item "covers" it.
const clash = structuredClone(again)
clash.apps[0].findings = [finding('AL-USA-1'), finding('AL-R2-USA-1')]
assert.match(merge(clash, two.data, {}).problems.join('\n'), /AL-USA-1 was already used by an earlier run/)

// Extract round-trips the data, including text that would close the script tag.
const tricky = structuredClone(two.data)
tricky.items[0].problem = 'ends a tag: </script> and <b>'
assert.deepEqual(extract(render(tricky)), tricky)

console.log('build-report: all checks passed')
