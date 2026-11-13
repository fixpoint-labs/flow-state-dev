/**
 * page-loop — one docs page through the ten passes of `docs/contributing/user-docs.md` → "Writing a
 * page: the ten passes", leaving `<page>.record.md` beside the page in the format
 * `scripts/check-docs-page.mjs` checks.
 *
 * NOT RUNNABLE STANDALONE. This is a Claude Code **Workflow script**: the harness injects
 * `agent` / `parallel` / `log` / `phase` / `args` as globals and wraps the body in an async
 * function, so the top-level `return` is legal here. Contract: `docs/contributing/orchestration.md`
 * → "The workflow-script contract"; `verify.mjs` tests it. Never run in CI: a run costs a few dozen
 * agents, and CI checks the record a run leaves, not the run.
 *
 * Args: `{ page, writer, dir? }`. `page` is a sitemap id (`C-07`); `writer` is the model for the
 * passes that write (1, 3 and 8); `dir` puts the page somewhere other than the revamp's pages
 * folder, for a run kept as evidence. The page file is the entry's slug under that folder
 * (`concepts/blocks` → `<dir>/concepts/blocks.md`; a folder slug `catalog/workforce/` →
 * `<dir>/catalog/workforce/index.md`), so R-01 `reference/blocks` and C-02
 * `concepts/blocks` never share a file. One page predates the section folders: a page at
 * `<dir>/<last segment>.md` that is this entry's (its record names the id, or, with no record, its
 * title and type are the entry's) is used where it is. A target that exists and is another entry's
 * stops the run before any agent writes.
 *
 * Every path and model name reaches a shell command or a fenced record, so each is allow-listed
 * before the first agent runs (`SEGMENT`, `MODEL`). The agents that read text a contributor wrote
 * and need no shell run as `code-reader` (passes 5, 6) and `cold-reader` (pass 9), which have no
 * Bash; only pass 4, the file scout and the record agent run commands.
 *
 * The order the script holds, which is the point of a script over a checklist:
 *   - pass 2's questions come from an agent that has seen no draft, and go to pass 9 unchanged;
 *   - pass 3 is skipped only for an entry the sitemap lists as kept, piloted or drafted;
 *   - every revision is followed by pass 4 again, and pass 9 reads the page pass 4 last read.
 *
 * REVISE. Passes 4 (a failing check), 5 (an untrue claim), 6 (mechanism on the page), 7
 * (`docs-editor` says REVISE) and 9 (a question most readers missed) send the page back to pass 8.
 * Pass 8 is one revise round: the writer takes the findings, then pass 4 runs again, and pass 7 runs
 * again if its last verdict was REVISE. Pass 5 and 6 findings are taken in the first round only;
 * pass 9 runs again with fresh readers and the same questions after a round its gaps caused. At most
 * MAX_ROUNDS rounds per page (the writer/editor limit in `user-docs.md`). A page that still has open
 * findings at the cap is escalated: pass 9 still runs once, and the record carries passes 1 to 9
 * with every round, a `Loop: escalated` line, and no pass 10, so the record check fails until the
 * owner reads the page and records it. PR feedback's twelve-round cap is not this.
 *
 * What it does NOT do (a script can't): read or write files itself, read for the owner, or open a PR.
 * Pass 10 is recorded `Not sampled` on a page that closed; the owner rewrites it to `Read` on reading.
 */

export const meta = {
  name: 'page-loop',
  description:
    'Run one docs page through the ten writing passes (fact sheet to owner read), with docs-writer and docs-editor as passes 1 and 7, and write its record.',
  whenToUse:
    'Writing or rewriting one revamp docs page. Args { page: "<sitemap id>", writer: "<model>", dir? }. Not run in CI.',
  phases: [
    { title: 'Plan', detail: 'read the sitemap entry: slug, title, type, whether the draft is skipped' },
    { title: 'Write', detail: 'pass 1 fact sheet, pass 2 cold-read questions, pass 3 draft' },
    { title: 'Check', detail: 'pass 4 machine checks, pass 5 fact check, pass 6 depth pass, pass 7 docs-editor' },
    { title: 'Revise', detail: 'pass 8, then pass 4 (and pass 7) again, up to the round cap' },
    { title: 'Cold read', detail: 'pass 9: fresh readers answer pass 2’s questions from the page alone' },
    { title: 'Record', detail: 'write <page>.record.md and run the record check' },
  ],
}

// The Workflow tool delivers `args` as a JSON string; ad-hoc runs may pass an object.
const A = typeof args === 'string' ? JSON.parse(args) : args || {}
if (typeof A.page !== 'string' || !/^[SCKBR]-\d{1,2}$/.test(A.page)) throw new Error('page-loop: args.page must be a sitemap id, like "C-07"')
if (typeof A.writer !== 'string' || !A.writer.trim()) throw new Error('page-loop: args.writer must name the writer model')
// A path segment or a model name as a shell command and a record may carry them: no quote, `$`,
// backtick, space or newline, and no `.` or `..` segment, so a path stays under its folder.
const SEGMENT = /^(?!\.{1,2}$)[A-Za-z0-9._-]+$/
const MODEL = /^[A-Za-z0-9._:-]+$/
const safePath = (p) => p.split('/').every((seg) => SEGMENT.test(seg) && !seg.includes('..'))
if (!MODEL.test(A.writer.trim())) throw new Error('page-loop: args.writer must be a model name: letters, digits, `.`, `_`, `:` and `-` only')
if (A.dir != null && (typeof A.dir !== 'string' || !safePath(A.dir.trim().replace(/\/+$/, '')))) {
  throw new Error('page-loop: args.dir must be a relative folder whose segments are letters, digits, `.`, `_` and `-`, with no `..`')
}

// Revise rounds per page: `user-docs.md` → "Who writes them" sends findings back three times, then a human decides.
const MAX_ROUNDS = 3
// Fresh agents per cold read. "Most readers" is more than half of them.
const READERS = 3
const PAGES = 'docs/contributing/docs-revamp/pages'
const SITEMAP = 'specs/epics/FIX-2696/SITEMAP'
// The sitemap's sections, each a folder under the pages folder (the section specs place them there).
const SECTIONS = ['start', 'concepts', 'catalog', 'build', 'reference']
const DIR = typeof A.dir === 'string' && A.dir.trim() ? A.dir.trim().replace(/\/+$/, '') : PAGES
const WRITER = A.writer.trim()

const STANDARD = 'Read docs/contributing/user-docs.md first; it is the standard every pass applies (page types and budgets, the concept outline, the moves, code examples, what a fact sheet may cite, the ten passes).'

/** One line of a finding, safe inside a record section: no line of it can open a new section. */
const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()

/**
 * The first 12 hex digits of the SHA-256 of `text` as UTF-8, the same digits `sha256sum` prints for
 * the file. Passes 4 and 5 name the page revision they checked with it, so a record for an edited
 * page never repeats its base's entries (`check-docs-page.mjs --changed-since` rejects that). Plain
 * JS: a workflow script has no imports.
 */
function sha256(text) {
  const bytes = []
  for (const ch of String(text)) {
    const c = ch.codePointAt(0)
    if (c < 0x80) bytes.push(c)
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  const bits = bytes.length * 8
  bytes.push(0x80)
  while (bytes.length % 64 !== 56) bytes.push(0)
  for (let i = 56; i >= 0; i -= 8) bytes.push(Math.floor(bits / 2 ** i) & 255)
  const primes = []
  for (let n = 2; primes.length < 64; n++) if (primes.every((q) => n % q)) primes.push(n)
  const frac = (x) => ((x - Math.floor(x)) * 2 ** 32) >>> 0
  const K = primes.map((q) => frac(Math.cbrt(q)))
  const h = primes.slice(0, 8).map((q) => frac(Math.sqrt(q)))
  const rotr = (x, n) => (x >>> n) | (x << (32 - n))
  for (let at = 0; at < bytes.length; at += 64) {
    const w = []
    for (let i = 0; i < 64; i++) {
      if (i < 16) w[i] = ((bytes[at + 4 * i] << 24) | (bytes[at + 4 * i + 1] << 16) | (bytes[at + 4 * i + 2] << 8) | bytes[at + 4 * i + 3]) >>> 0
      else {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
      }
    }
    let [a, b, c, d, e, f, g, k] = h
    for (let i = 0; i < 64; i++) {
      const t1 = (k + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0
      ;[k, g, f, e, d, c, b, a] = [g, f, e, (d + t1) >>> 0, c, b, a, (t1 + t2) >>> 0]
    }
    ;[a, b, c, d, e, f, g, k].forEach((v, i) => (h[i] = (h[i] + v) >>> 0))
  }
  return h.map((v) => v.toString(16).padStart(8, '0')).join('').slice(0, 12)
}

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    found: { type: 'boolean' },
    slug: { type: 'string', description: 'The entry’s slug on the site, e.g. concepts/state-and-scopes' },
    title: { type: 'string', description: 'The entry’s title, exactly as the sitemap gives it' },
    type: { type: 'string', enum: ['start', 'concept', 'catalog', 'tutorial', 'recipe', 'reference'] },
    status: { type: 'string', enum: ['new', 'kept', 'piloted', 'drafted'] },
    entry: { type: 'string', description: 'The sitemap entry, verbatim' },
  },
  required: ['found', 'slug', 'title', 'type', 'status', 'entry'],
}

const FILES_SCHEMA = {
  type: 'object',
  properties: {
    files: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'The path, exactly as given' },
          exists: { type: 'boolean' },
          recordSitemap: { type: 'string', description: 'The id on the `Sitemap:` line of the page’s .record.md, or "" when it has no record' },
          title: { type: 'string', description: 'The `title` in its frontmatter, or ""' },
          type: { type: 'string', description: 'The `type` in its frontmatter, or ""' },
        },
        required: ['path', 'exists', 'recordSitemap', 'title', 'type'],
      },
    },
  },
  required: ['files'],
}

const FACTS_SCHEMA = {
  type: 'object',
  properties: { facts: { type: 'integer', minimum: 0 }, summary: { type: 'string' } },
  required: ['facts', 'summary'],
}

const QUESTIONS_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          answer: { type: 'string', description: 'The answer, from the fact sheet, with the fact it rests on' },
          edge: { type: 'boolean', description: 'An edge case: a failure, a second user, an edit' },
        },
        required: ['question', 'answer', 'edge'],
      },
    },
  },
  required: ['questions'],
}

const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    scenario: { type: 'string', description: 'The one concrete scenario the page carries, with its names' },
    words: { type: 'integer', minimum: 0 },
    figures: { type: 'array', items: { type: 'string' }, description: 'Each figure file drawn' },
  },
  required: ['scenario', 'words', 'figures'],
}

const CHECKS_SCHEMA = {
  type: 'object',
  properties: {
    checks: {
      type: 'array',
      items: {
        type: 'object',
        properties: { check: { type: 'string' }, ok: { type: 'boolean' }, detail: { type: 'string' } },
        required: ['check', 'ok', 'detail'],
      },
    },
    page: { type: 'string', description: 'The page file’s full text, verbatim, as you read it' },
  },
  required: ['checks', 'page'],
}

const FACT_CHECK_SCHEMA = {
  type: 'object',
  properties: {
    untrue: {
      type: 'array',
      items: {
        type: 'object',
        properties: { claim: { type: 'string' }, truth: { type: 'string' }, where: { type: 'string', description: 'file:line' } },
        required: ['claim', 'truth', 'where'],
      },
    },
  },
  required: ['untrue'],
}

const DEPTH_SCHEMA = {
  type: 'object',
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          paragraph: { type: 'string', description: 'The paragraph’s first words' },
          row: { type: 'string', description: 'The Reference row the mechanism becomes' },
          referencePage: { type: 'string', description: 'The R-page it belongs on, by sitemap id' },
        },
        required: ['paragraph', 'row', 'referencePage'],
      },
    },
  },
  required: ['rows'],
}

const EDITOR_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['SHIP', 'REVISE'] },
    findings: { type: 'array', items: { type: 'string' }, description: 'Line-anchored findings' },
  },
  required: ['verdict', 'findings'],
}

const REVISE_SCHEMA = {
  type: 'object',
  properties: {
    changed: { type: 'array', items: { type: 'string' } },
    declined: {
      type: 'array',
      items: {
        type: 'object',
        properties: { finding: { type: 'string' }, why: { type: 'string', description: 'The rule in user-docs.md taking it would undo' } },
        required: ['finding', 'why'],
      },
    },
  },
  required: ['changed', 'declined'],
}

const READER_SCHEMA = {
  type: 'object',
  properties: {
    answers: { type: 'array', items: { type: 'string' }, description: 'One answer per question, in order' },
    guessed: { type: 'array', items: { type: 'string' }, description: 'Every term you had to guess at' },
  },
  required: ['answers', 'guessed'],
}

const GRADE_SCHEMA = {
  type: 'object',
  properties: {
    grades: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          reader: { type: 'integer', minimum: 1 },
          question: { type: 'integer', minimum: 1 },
          correct: { type: 'boolean' },
        },
        required: ['reader', 'question', 'correct'],
      },
    },
  },
  required: ['grades'],
}

const RECORD_SCHEMA = {
  type: 'object',
  properties: {
    written: { type: 'boolean' },
    checkerExit: { type: 'integer' },
    checkerOutput: { type: 'string' },
  },
  required: ['written', 'checkerExit', 'checkerOutput'],
}

const failed = (at, extra = {}) => {
  log(`${at} returned nothing; stopping with no record`)
  return { status: 'failed', page: A.page, at, ...extra }
}

// --- Pass helpers -------------------------------------------------------------------------------
// Declared before the flow that calls them. They read the run's state declared below (PATH,
// QUESTIONS, `checks`, `edits`); the flow calls each only once that state is set.

/** Pass 4 on the page as it stands. `after` says what last changed it, for the record. */
async function machineChecks(after, n) {
  phase(n === 0 ? 'Check' : 'Revise')
  const out = await agent(
    `You are pass 4 of the ten passes: the machine checks on ${PATH}. Run each and report it: its result line (the word count, for check-docs-page), and the failing lines when it fails:
- \`node scripts/check-docs-page.mjs ${PATH}\` (budget, banned words, code titles, fences)
- a type-check of every TypeScript example on the page, against the workspace packages
- \`node scripts/check-retired-terms.mjs\`, for any line of this page it names
- \`node apps/docs/scripts/lint-brand.mjs <each figure the page shows>\`, when it shows any
Then return the page file's full text verbatim. Edit nothing.`,
    { label: `pass-4:${n}`, phase: n === 0 ? 'Check' : 'Revise', schema: CHECKS_SCHEMA },
  )
  return out && { ...out, after, ok: out.checks.every((c) => c.ok), sha: sha256(out.page) }
}

/** Pass 7, round `n`. */
function editor(n) {
  return agent(
    `You are pass 7 of the ten passes: review the prose of ${PATH}${n > 1 ? ` again, after revise round ${n - 1}` : ''}. Return your verdict and line-anchored findings.`,
    { label: `pass-7:${n}`, phase: n === 1 ? 'Check' : 'Revise', schema: EDITOR_SCHEMA, agentType: 'docs-editor' },
  )
}

/** What is open after the latest pass 4 and pass 7: each `{ from, text }`. */
function openFindings() {
  const out = checks.checks.filter((c) => !c.ok).map((c) => ({ from: 'pass 4', text: `${c.check}: ${c.detail}` }))
  const edit = edits.at(-1)
  if (edit.verdict === 'REVISE') out.push(...edit.findings.map((f) => ({ from: 'pass 7', text: f })))
  return out
}

/** Pass 9: READERS fresh agents with the page text and the questions, then one grader with the key. */
async function coldRead(n) {
  phase('Cold read')
  const page = checks.page
  const numbered = QUESTIONS.map((q, i) => `${i + 1}. ${q.question}`).join('\n')
  const answers = await parallel(
    Array.from({ length: READERS }, (_, r) => () =>
      agent(
        `Use no tools: read nothing, search nothing, run nothing. Below is one documentation page and ${QUESTIONS.length} questions. Answer each from the page alone, one answer per question, in order. If the page does not say, answer "The page does not say." Then list every term you had to guess at.

PAGE:
${page}

QUESTIONS:
${numbered}`,
        { label: `pass-9:${n}:reader-${r + 1}`, phase: 'Cold read', schema: READER_SCHEMA, agentType: 'cold-reader' },
      ),
    ),
  )
  const readers = answers.map((a, r) => (a ? { reader: r + 1, ...a } : null)).filter(Boolean)
  if (readers.length < 2) return null
  const graded = await agent(
    `Grade cold readers' answers against the answer key. An answer is correct when it reaches the key's answer; wording does not matter. Return one grade per reader per question. Use no tools.

KEY:
${QUESTIONS.map((q, i) => `${i + 1}. ${q.question}\n   Answer: ${q.answer}`).join('\n')}

ANSWERS:
${readers.map((r) => `Reader ${r.reader}:\n${r.answers.map((a, i) => `  ${i + 1}. ${one(a)}`).join('\n')}`).join('\n')}`,
    { label: `pass-9:${n}:grade`, phase: 'Cold read', schema: GRADE_SCHEMA, agentType: 'cold-reader' },
  )
  if (!graded) return null
  const missed = QUESTIONS.map((q, i) => readers.filter((r) => !graded.grades.some((g) => g.reader === r.reader && g.question === i + 1 && g.correct)).length)
  const gaps = QUESTIONS.flatMap((q, i) => (missed[i] * 2 > readers.length ? [`"${q.question}" missed by ${missed[i]} of ${readers.length} readers; the key: ${q.answer}`] : []))
  return { n, readers: readers.length, missed, gaps, guessed: [...new Set(readers.flatMap((r) => r.guessed.map(one)))] }
}

// --- Plan ---------------------------------------------------------------------------------------

phase('Plan')
const plan = await agent(
  `Find sitemap entry ${A.page} in ${SITEMAP}/ (README.md says how to read an entry). Run \`node scripts/check-docs-page.mjs --sitemap\` and report the entry's status from it: kept, piloted or drafted, or new when it is in none of those lists. Return the entry verbatim. Read only; edit nothing.`,
  { label: 'plan', phase: 'Plan', schema: PLAN_SCHEMA, agentType: 'scout' },
)
if (!plan) return failed('plan')
if (!plan.found) return { status: 'blocked', page: A.page, reason: `the sitemap has no entry ${A.page}` }

// The slug comes from an agent that read contributor text: it becomes a path only in a known section,
// with every segment allow-listed. A slug ending in `/` is a folder's index page (`catalog/workforce/`
// is `catalog/workforce/index.md`, as the docs site reads a folder).
const SLUG = plan.slug.endsWith('/') ? `${plan.slug}index` : plan.slug
const slug = SLUG.split('/')
if (slug.length < 2 || !SECTIONS.includes(slug[0]) || !safePath(SLUG)) {
  return { status: 'blocked', page: A.page, reason: `the sitemap gives ${A.page} the slug ${JSON.stringify(plan.slug)}, which is not <section>/<name> in one of ${SECTIONS.join(', ')} with plain segments` }
}
const TITLE = one(plan.title)
const NAMESPACED = `${DIR}/${SLUG}.md`
const FLAT = `${DIR}/${slug.at(-1)}.md`

const seen = await agent(
  `For each path below, say whether the file exists; if it does, give the id on the \`Sitemap:\` line of the .record.md beside it ("" when there is none) and the \`title\` and \`type\` in its frontmatter ("" when absent). Return one entry per path, the path exactly as given. Read only; edit nothing.

FILES:
- ${NAMESPACED}
- ${FLAT}`,
  { label: 'inspect', phase: 'Plan', schema: FILES_SCHEMA, agentType: 'scout' },
)
if (!seen) return failed('inspect')
const file = (path) => seen.files.find((f) => f.path === path)
if (!file(NAMESPACED) || !file(FLAT)) return failed('inspect', { reason: 'the file scout left out a path it was given' })
// This entry's page: its record names the id, or, with no record yet, its title and type are the entry's.
const mine = (f) => (f.recordSitemap ? f.recordSitemap === A.page : one(f.title).toLowerCase() === TITLE.toLowerCase() && f.type === plan.type)
// The one flat page from before the section folders is used where it is; every other page is namespaced.
const target = FLAT !== NAMESPACED && file(FLAT).exists && mine(file(FLAT)) ? file(FLAT) : file(NAMESPACED)
const PATH = target.path
if (target.exists && !mine(target)) {
  const owner = target.recordSitemap || `a ${target.type || 'page'} titled "${one(target.title)}"`
  return { status: 'blocked', page: A.page, path: PATH, reason: `${PATH} is ${owner}'s page, not ${A.page}'s; nothing was written` }
}
const FACTS = PATH.replace(/\.md$/, '.facts.md')
const RECORD = PATH.replace(/\.md$/, '.record.md')
const SKIP = plan.status !== 'new'
if (SKIP && !target.exists) {
  return { status: 'blocked', page: A.page, path: PATH, reason: `${A.page} is ${plan.status} in the sitemap, so the draft is skipped, and there is no page at ${PATH} yet. Put the existing page there first.` }
}
const ENTRY = `SITEMAP ENTRY ${A.page} (the page plan):\n${plan.entry}`

// --- Passes 1 to 3 ------------------------------------------------------------------------------

phase('Write')
const facts = await agent(
  `You are pass 1 of the ten passes: the fact sheet. ${STANDARD}

Write ${FACTS}: every fact the page "${TITLE}" (${plan.type}) will state, each with file and line, citing only what a fact sheet may cite. If the page is about something that stores data, answer the four questions for each stored part. Do not write the page.

${ENTRY}`,
  { label: 'pass-1', phase: 'Write', schema: FACTS_SCHEMA, agentType: 'docs-writer', model: WRITER },
)
if (!facts) return failed('pass 1')

const asked = await agent(
  `You are pass 2 of the ten passes: the cold-read questions. ${STANDARD}

Write five or six scenario questions a reader should be able to answer after reading the page "${TITLE}", at least two of them edge cases (a failure, a second user, an edit), each with its answer from the fact sheet ${FACTS}. Start from the entry's "After reading" questions and use the page's cast. You have seen no draft and must not: do not open ${PATH}${SKIP ? ' (it exists; leave it closed)' : ''}, nor any other draft of this page. Read only; edit nothing.

${ENTRY}`,
  { label: 'pass-2', phase: 'Write', schema: QUESTIONS_SCHEMA },
)
if (!asked) return failed('pass 2')
// Frozen here: pass 9 gets exactly these. A question edited after a draft exists is a new question.
const QUESTIONS = asked.questions
const edges = QUESTIONS.filter((q) => q.edge).length
if (QUESTIONS.length < 5 || QUESTIONS.length > 6 || edges < 2) {
  return { status: 'failed', page: A.page, at: 'pass 2', reason: `pass 2 wrote ${QUESTIONS.length} questions with ${edges} edge cases; the standard asks five or six with at least two` }
}

let draft = null
if (!SKIP) {
  draft = await agent(
    `You are pass 3 of the ten passes: the draft. ${STANDARD} Read docs/contributing/user-docs-figures.md before drawing.

Write ${PATH}, a ${plan.type} page titled "${TITLE}" with \`type: ${plan.type}\` and that title in its frontmatter. Choose one concrete scenario with names in it; write the opening and the outline first, and start again if the opening needs a framework term to make sense. Aim well under the budget (about 700 words of prose for a concept page) and state nothing that is not on the fact sheet ${FACTS}. Draw the figures the entry briefs.

${ENTRY}`,
    { label: 'pass-3', phase: 'Write', schema: DRAFT_SCHEMA, agentType: 'docs-writer', model: WRITER },
  )
  if (!draft) return failed('pass 3')
}

// --- Passes 4 to 7 ------------------------------------------------------------------------------

let checks = await machineChecks(SKIP ? 'the page as it was kept' : 'the draft', 0)
if (!checks) return failed('pass 4')
const checkRuns = [checks]

const [factCheck, depth, firstEdit] = await parallel([
  () =>
    agent(
      `You are pass 5 of the ten passes: the fact check. You have the page ${PATH} and the code, and nothing else: do not read its fact sheet, the sitemap or any spec. Return each claim the page makes that is not true, with what is true and its file and line. Read only.`,
      { label: 'pass-5', phase: 'Check', schema: FACT_CHECK_SCHEMA, agentType: 'code-reader' },
    ),
  () =>
    agent(
      `You are pass 6 of the ten passes: the depth pass. ${STANDARD} For each paragraph of ${PATH}, ask: is this the model, or mechanism? Return each paragraph that is mechanism as the Reference row it becomes and the R-page (sitemap id, see ${SITEMAP}/reference.md) it belongs on. Read only.`,
      { label: 'pass-6', phase: 'Check', schema: DEPTH_SCHEMA, agentType: 'code-reader' },
    ),
  () => editor(1),
])
if (!factCheck) return failed('pass 5')
if (!depth) return failed('pass 6')
if (!firstEdit) return failed('pass 7')
const edits = [firstEdit]

// --- Revise rounds and the cold read -------------------------------------------------------------

let pending = [
  ...openFindings(),
  ...factCheck.untrue.map((u) => ({ from: 'pass 5', text: `${u.claim} Untrue: ${u.truth} (${u.where})` })),
  ...depth.rows.map((r) => ({ from: 'pass 6', text: `Move to ${r.referencePage} as "${r.row}" and link it: the paragraph starting "${r.paragraph}"` })),
]
const rounds = []
const reads = []
let escalated = null

for (;;) {
  while (pending.length && rounds.length < MAX_ROUNDS) {
    const n = rounds.length + 1
    phase('Revise')
    const revised = await agent(
      `You are pass 8 of the ten passes: revise round ${n} of at most ${MAX_ROUNDS}, on ${PATH}. ${STANDARD}

Take every factual correction, every depth finding (the paragraph leaves the page; link the Reference page instead) and every machine-check failure. Take a prose finding unless it would undo something the standard asks for; say which rule when you decline one. A question most readers missed means the page does not make its answer findable: fix the page, never the question. Keep the fact sheet ${FACTS} true to every change.

FINDINGS:
${pending.map((f, i) => `${i + 1}. [${f.from}] ${one(f.text)}`).join('\n')}`,
      { label: `pass-8:${n}`, phase: 'Revise', schema: REVISE_SCHEMA, agentType: 'docs-writer', model: WRITER },
    )
    if (!revised) return failed(`pass 8 round ${n}`)
    rounds.push({ n, findings: pending, ...revised })
    checks = await machineChecks(`revise round ${n}`, n)
    if (!checks) return failed(`pass 4 after round ${n}`)
    checkRuns.push(checks)
    if (edits.at(-1).verdict === 'REVISE') {
      const edit = await editor(edits.length + 1)
      if (!edit) return failed(`pass 7 round ${edits.length + 1}`)
      edits.push(edit)
    }
    pending = openFindings()
  }

  // The cold-read join, reached when nothing is pending or the round cap is spent. Three exits:
  //   - success: nothing pending and no gap; the page closes and pass 10 is recorded Not sampled;
  //   - gap -> revise: under the cap, the gaps become the next round's findings and the loop re-enters;
  //   - escalate: at the cap, everything still open (pass 4 and 7, and this read's gaps) goes to the
  //     owner, and the record carries no pass 10.
  const read = await coldRead(reads.length + 1)
  if (!read) return failed('pass 9')
  reads.push(read)
  const gaps = read.gaps.map((g) => ({ from: 'pass 9', text: g }))
  // At the cap, everything still open goes to the owner in one list: pass 4 and 7, and this read's gaps.
  if (pending.length || (gaps.length && rounds.length >= MAX_ROUNDS)) {
    escalated = [...pending, ...gaps]
    break
  }
  if (!gaps.length) break
  pending = gaps
}

// --- The record ---------------------------------------------------------------------------------

const list = (items, empty) => (items.length ? items.map((s) => `- ${one(s)}`).join('\n') : empty)
const sections = []
const section = (n, name, body) => sections.push(`## ${n} · ${name}\n\n${body}`)

section(1, 'Fact sheet', `Written by \`docs-writer\` (${WRITER}): \`${FACTS.split('/').pop()}\`, ${facts.facts} facts. ${one(facts.summary)}`)
section(
  2,
  'Cold-read questions',
  `Written by an agent that had seen no draft. Pass 9 got these unchanged.\n\n${QUESTIONS.map((q, i) => `${i + 1}. ${one(q.question)}${q.edge ? ' *(edge case)*' : ''}\n   Answer: ${one(q.answer)}`).join('\n')}`,
)
section(
  3,
  'Draft',
  SKIP
    ? `Skipped: ${A.page} is ${plan.status} in the sitemap, and the page was already at \`${PATH.split('/').pop()}\`.`
    : `Written by \`docs-writer\` (${WRITER}), ${draft.words} words. Scenario: ${one(draft.scenario)}${draft.figures.length ? ` Figures: ${draft.figures.map(one).join(', ')}.` : ''}`,
)
section(
  4,
  'Machine checks',
  checkRuns.map((c) => `- After ${c.after}, page sha256 ${c.sha}: ${c.ok ? 'pass' : 'FAIL'}. ${c.checks.map((x) => `${one(x.check)} ${x.ok ? 'ok' : 'failed'} (${one(x.detail)})`).join('; ')}`).join('\n'),
)
section(
  5,
  'Fact check',
  `Checked against the code: the page as pass 4 read it after ${checkRuns[0].after}, sha256 ${checkRuns[0].sha}.\n\n${list(factCheck.untrue.map((u) => `${u.claim} Untrue: ${u.truth} (${u.where})`), 'No untrue claim found.')}`,
)
section(6, 'Depth pass', depth.rows.length ? `${depth.rows.length} paragraph(s) of mechanism, moved in revise round 1; see Reference rows.` : 'Every paragraph is the model; none moved.')
section(
  7,
  'docs-editor',
  edits.map((e, i) => `- Round ${i + 1}: ${e.verdict}${e.findings.length ? `. ${e.findings.map(one).join(' · ')}` : ''}`).join('\n'),
)
section(
  8,
  'Revise',
  rounds.length
    ? `${rounds.length} round(s) of at most ${MAX_ROUNDS}.\n\n${rounds
        .map((r) => `- Round ${r.n}, from ${[...new Set(r.findings.map((f) => f.from))].join(', ')} (${r.findings.length} finding(s)). Changed: ${r.changed.map(one).join(' · ') || 'nothing'}.${r.declined.length ? ` Declined: ${r.declined.map((d) => `${one(d.finding)} (${one(d.why)})`).join(' · ')}.` : ''}`)
        .join('\n')}`
    : 'No findings from passes 4 to 7; the page was not changed.',
)
section(
  9,
  'Cold read',
  reads
    .map((r) => `- Read ${r.n}, ${r.readers} readers, no tools. Missed per question: ${r.missed.join(', ')}. ${r.gaps.length ? `Gaps: ${r.gaps.map(one).join(' · ')}.` : 'No gap.'}${r.guessed.length ? ` Guessed at: ${r.guessed.join(', ')}.` : ''}`)
    .join('\n'),
)
if (!escalated) section(10, 'Owner read', 'Not sampled. The owner replaces this with `Read`, the date and what they found, when they read the page.')
sections.push(`## Reference rows\n\n${list(depth.rows.map((r) => `${r.row} → ${r.referencePage}`), 'None.')}`)

const head = [`# ${TITLE} · record`, '', `Sitemap: ${A.page}`]
if (escalated) {
  head.push('', `Loop: escalated after ${rounds.length} revise round(s) with ${escalated.length} finding(s) open. Pass 10 is the owner's: they read the page and record it.`, '', list(escalated.map((f) => `[${f.from}] ${f.text}`), ''))
}
const RECORD_TEXT = `${[...head, '', ...sections].join('\n\n').replace(/\n{3,}/g, '\n\n')}\n`

phase('Record')
// The record agent copies the text between the markers; text that carried a marker would end the
// copy early and hand the agent whatever follows as instructions.
if (/<<<RECORD|RECORD>>>/.test(RECORD_TEXT)) {
  log('the record text contains a record marker; not handing it to the record agent')
  return { status: 'failed', at: 'record', page: A.page, path: PATH, record: RECORD, reason: 'the record text contains <<<RECORD or RECORD>>>', recordText: RECORD_TEXT }
}
const written = await agent(
  `Write ${RECORD} with exactly the text between the markers, byte for byte, replacing any file there. Then run \`node scripts/check-docs-page.mjs ${PATH} --record\` and return its exit code and output. Edit nothing else.

<<<RECORD
${RECORD_TEXT}RECORD>>>`,
  { label: 'record', phase: 'Record', schema: RECORD_SCHEMA },
)
// A closed page whose record is not on disk, or does not pass the check CI runs, is not done.
let status = escalated ? 'escalated' : 'complete'
let at
if (!written || !written.written) {
  log(`no record written; the record text is in the result, for ${RECORD}`)
  status = 'failed'
  at = 'record'
} else if (!escalated && written.checkerExit !== 0) {
  log(`the record check failed on a page that closed:\n${written.checkerOutput}`)
  status = 'failed'
  at = 'record check'
}

return {
  status,
  ...(at ? { at } : {}),
  page: A.page,
  path: PATH,
  record: RECORD,
  recordText: RECORD_TEXT,
  rounds: rounds.length,
  open: escalated ?? [],
  check: written,
}
