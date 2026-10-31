#!/usr/bin/env node
/**
 * build-report — turn an `app-review` workflow result into report data and a publishable page.
 *
 * The merge is code, not an agent: in fold mode the synthesizer returns `updates` to prior items
 * plus `newItems`, and this applies them to the prior report's data deterministically, so a
 * re-run never silently rewrites or drops an item it was only meant to extend.
 *
 *   node .agents/skills/app-review/build-report.mjs \
 *     --workflow <workflow output .json> [--prior <earlier data.json>] --out <dir> \
 *     [--title "Labs Improvement Map"] [--date 2026-10-31] [--focus "what the user asked to weigh"]
 *
 *   node .agents/skills/app-review/build-report.mjs --extract <published report .html> --out <dir>
 *
 * `--extract` recovers `data.json` from a report page (the Artifact tool's `read` saves one
 * locally), so a later session can fold into a report whose scratch files are long gone.
 *
 * `--workflow` takes the Workflow tool's output file as-is (`{ result: … }`, result possibly a
 * JSON string) or the bare `{ apps, synth }` return value. Writes `<out>/data.json` (feed it back
 * as `--prior` next run, and point the workflow's `prior.itemsFile` at it) and `<out>/report.html`
 * (publish with the Artifact tool). Exits non-zero when a finding is accounted for nowhere, or an
 * update names an item that doesn't exist: the report must not quietly lose work.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    if (!k.startsWith('--')) throw new Error(`unexpected argument ${k}`)
    out[k.slice(2)] = argv[++i]
  }
  return out
}

/** Unwrap the Workflow tool's output file down to the script's return value. */
export function unwrapWorkflow(raw) {
  let v = raw
  if (v && typeof v === 'object' && 'result' in v && !('synth' in v)) v = v.result
  if (typeof v === 'string') v = JSON.parse(v)
  if (!v || !Array.isArray(v.apps)) throw new Error('workflow output has no apps[]; is this an app-review result?')
  if (!v.synth) throw new Error('workflow output has no synth (the synthesizer died or found nothing); nothing to report')
  return v
}

const uniq = (xs) => [...new Set(xs)]

/**
 * Merge a workflow result into report data.
 * @param {object} wf   unwrapped workflow result `{ mode, apps, synth }`
 * @param {object|null} prior  an earlier `data.json`, required in fold mode
 * @param {{title?: string, date?: string, focus?: string}} meta
 * @returns {{ data: object, problems: string[] }}
 */
export function merge(wf, prior, meta = {}) {
  const problems = []
  const s = wf.synth
  const fold = Array.isArray(s.updates)
  if (fold && !prior) throw new Error('fold-mode result (updates/newItems) needs --prior <data.json>')

  // Re-reviewing an app keeps its earlier findings (earlier items cite them) and takes the new
  // brief. A new finding whose id an earlier run already used would make those citations point at
  // the wrong finding and fool the coverage check below, so it is a problem, not a merge.
  const priorIds = new Set((prior ? prior.apps : []).flatMap((a) => a.findings.map((f) => f.id)))
  for (const a of wf.apps) {
    for (const f of a.findings) if (priorIds.has(f.id)) problems.push(`finding id ${f.id} was already used by an earlier run; pass a fresh runTag`)
  }
  const appsOut = (prior ? prior.apps.filter((a) => !wf.apps.some((n) => n.app === a.key)) : []).concat(
    wf.apps.map((a) => {
      const before = prior && prior.apps.find((p) => p.key === a.app)
      return { key: a.app, name: a.name || (before && before.name) || a.app, dir: a.dir || (before && before.dir) || '', brief: a.brief, findings: [...(before ? before.findings : []), ...a.findings] }
    }),
  )

  let items
  let themes
  if (fold) {
    items = prior.items.map((i) => ({ ...i, apps: [...i.apps], sourceFindings: [...i.sourceFindings], evidence: [...i.evidence], notes: [...(i.notes || [])] }))
    const byId = new Map(items.map((i) => [i.id, i]))
    for (const u of s.updates) {
      const it = byId.get(u.id)
      if (!it) {
        problems.push(`update for unknown item ${u.id}`)
        continue
      }
      it.apps = uniq([...it.apps, ...u.addApps])
      it.sourceFindings = uniq([...it.sourceFindings, ...u.addSourceFindings])
      it.evidence = uniq([...it.evidence, ...u.addEvidence])
      if (u.note) it.notes.push({ apps: u.addApps, text: u.note })
      if (u.newHome && u.newHome !== it.home) {
        it.homeChange = { from: it.home, fromPackage: it.package, reason: u.homeChangeReason }
        it.home = u.newHome
      }
      if (u.newPackage) it.package = u.newPackage
      if (u.newPriority && u.newPriority !== it.priority) {
        it.priorityChange = { from: it.priority }
        it.priority = u.newPriority
      }
    }
    for (const n of s.newItems) {
      if (byId.has(n.id)) problems.push(`new item ${n.id} reuses an existing id`)
      items.push({ ...n, isNew: true, notes: [] })
    }
    themes = [...prior.themes, ...s.newThemes.filter((t) => !prior.themes.some((p) => p.name === t.name))]
  } else {
    items = s.items.map((i) => ({ ...i, notes: [] }))
    themes = s.themes
  }

  const rejected = [...((prior && prior.rejected) || []), ...s.rejected]
  const covered = new Set([...items.flatMap((i) => i.sourceFindings), ...rejected.map((r) => r.findingId)])
  for (const a of wf.apps) for (const f of a.findings) if (!covered.has(f.id)) problems.push(`finding ${f.id} is in no item and not rejected`)
  const known = new Set(appsOut.map((a) => a.key))
  for (const i of items) for (const a of i.apps) if (!known.has(a)) problems.push(`${i.id} names unknown app ${a}`)

  const runs = [...((prior && prior.runs) || []), { date: meta.date || '', apps: wf.apps.map((a) => a.app), focus: meta.focus || '', summary: s.executiveSummary }]
  const data = {
    title: meta.title || (prior && prior.title) || 'App Review',
    date: meta.date || '',
    focus: meta.focus || (prior && prior.focus) || '',
    apps: appsOut,
    items,
    themes,
    rejected,
    runs,
  }
  return { data, problems }
}

/** Recover report data from a rendered report page. */
export function extract(html) {
  const m = /<script id="data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)
  if (!m) throw new Error('no app-review data block in that page')
  return JSON.parse(m[1].replace(/<\\\//g, '</'))
}

/** Inject data into the template. `</` is escaped so item text can't close the data tag. */
export function render(data) {
  const tpl = readFileSync(join(HERE, 'report-template.html'), 'utf8')
  const json = JSON.stringify(data).replace(/<\//g, '<\\/')
  return tpl.replace('__TITLE__', data.title.replace(/[<&]/g, '')).replace('__DATA__', () => json)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const a = parseArgs(process.argv.slice(2))
  if (a.extract && a.out) {
    mkdirSync(a.out, { recursive: true })
    const data = extract(readFileSync(a.extract, 'utf8'))
    writeFileSync(join(a.out, 'data.json'), JSON.stringify(data, null, 1))
    console.log(`${data.apps.length} apps · ${data.items.length} items → ${join(a.out, 'data.json')}`)
    process.exit(0)
  }
  if (!a.workflow || !a.out) {
    console.error('usage: build-report.mjs --workflow <file> [--prior <data.json>] --out <dir> [--title t] [--date d] [--focus f]\n       build-report.mjs --extract <report.html> --out <dir>')
    process.exit(2)
  }
  const wf = unwrapWorkflow(JSON.parse(readFileSync(a.workflow, 'utf8')))
  const prior = a.prior ? JSON.parse(readFileSync(a.prior, 'utf8')) : null
  const { data, problems } = merge(wf, prior, { title: a.title, date: a.date, focus: a.focus })
  mkdirSync(a.out, { recursive: true })
  writeFileSync(join(a.out, 'data.json'), JSON.stringify(data, null, 1))
  writeFileSync(join(a.out, 'report.html'), render(data))
  const n = (f) => data.items.filter(f).length
  console.log(
    `${data.apps.length} apps · ${data.apps.reduce((k, x) => k + x.findings.length, 0)} findings · ${data.items.length} items ` +
      `(${n((i) => i.apps.length > 1)} multi-app, ${n((i) => i.home !== 'app')} package-homed, ${n((i) => i.priority === 'P1')} P1) · ${data.rejected.length} rejected`,
  )
  console.log(`wrote ${join(a.out, 'data.json')} and ${join(a.out, 'report.html')}`)
  if (problems.length) {
    console.error(`\n${problems.length} problem(s):\n  ${problems.join('\n  ')}`)
    process.exit(1)
  }
}
