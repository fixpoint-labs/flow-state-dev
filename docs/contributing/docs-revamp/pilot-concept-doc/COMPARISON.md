# Concept-doc pilot: three ways to write the same three pages

The question: if the three pilot pages (What Flow State is, Tasks and boards, Workers) are written
through the `concept-doc` skill, are they better or worse than the current pilots, and in what way?

Three arms, the same reader and the same release (kits):

- **A**: the current pilots in `../pilot/`, unchanged.
- **B**: `concept-doc` run exactly, one doc per topic, in `b/`. This is the skill's own output, and
  it is not meant to be user docs.
- **C**: the route `concept-doc` says it feeds. `docs-writer` wrote each page from B's model plus the
  public surface, `docs-editor` reviewed it, and the writer revised once. In `c/`.

## Verdict

**Concept-doc made the facts better and the pages worse to read.** The writing loop (FIX-2701)
should take two of its steps, not the whole route.

**Where it helped.**

- **It found a fact the pilot gets wrong.** The current Workers page says nobody can edit a standard
  worker inside the app. The code allows it: an edit makes the user's own copy under the same id,
  and a reset removes the copy (`packages/workforce/src/workers/hire-blocks.ts:11-14`). B found this
  because the skill makes every stored part answer "who owns it, who can see it, where it's stored".
  C's Workers page says it correctly.
- **C's pages are better grounded.** They make 10 claims the fact checker could not support, against
  17 for A. C's writer also flagged two places where today's docs and code disagree (the task-board
  `claimOrder` default, and filing refusals that throw).
- **C's start page answers "which one do I change?" with a table.** That is the epic's own reader
  test, stated as a page section.

**Where it hurt.**

- **Readers understood C's pages least.** On the questions a page should answer, cold readers scored
  A 8 of 9, B 6.5 and C 5.5. On all 24 questions: A 15, B 13, C 9.5. C lost facts A gives in one
  line: the five block kinds by name, how a task gets its dependencies' results (`input.deps`), and
  what happens when a worker hands work to someone it can't.
- **C's pages describe the machinery.** B's model has 11 parts for task boards: leases, claims,
  holds, six statuses, four stop reasons. The writer kept most of them, and the brief says to state
  the guarantee and leave out the machinery. C's concept pages run about 1,200 words to A's 750–830.
  They are under budget, but longer for less understanding.
- **B is not a page.** Each doc runs 4,500–5,800 words, fails the page checker on every count it
  checks, and carries the most wrong claims (10). Most are in sections only a concept doc has:
  file counts, gap-table rows and the retired-terms table.

**What the loop should adopt.**

1. **Adopt the cold read** (`concept-doc` → "Checking it before you call it done"). Give a fresh
   agent only the page, with scenario questions that include edge cases, written before it reads
   the page. The brief's loop has a fact check and a prose check and no reader check. In this pilot
   the cold read found every arm's gaps, including the ones the fact check and the editor passed.
2. **Adopt the per-part ownership questions** when collecting facts for a page about something that
   stores data (workers, boards, sessions, kits): who owns it, who can see it, where it's stored, how
   many exist. That step caught the edit-a-standard-worker error.
3. **Do not adopt the full route** (write a concept doc, then hand it to `docs-writer`) for every
   page. It costs a 5,000-word doc per page and gave the worst reader scores. Keep it for areas
   whose model is unclear or contested, which is the skill's own "when to use it". Kits and slots is
   the likely candidate.

What would change this: a rerun with cold-read questions written by someone who has not read any
arm. If C or B then matches A, the reader result was my bias, not the route (see "What made it
unfair").

## Scores per page

Cold read is the median of three blind gradings of one reader's answers. "Page" means the three
questions written for that page (out of 3). "All" means those three plus the five reader questions
from the epic spec (out of 8). Fact counts are right / wrong / unsupported. Words are counted by
`node scripts/check-docs-page.mjs`.

| Page | Arm | Words | Checker | Facts R / W / U | Cold read: page /3 | Cold read: all /8 | Editor |
| --- | --- | ---: | --- | --- | ---: | ---: | --- |
| What Flow State is | A | 621 | ok | 31 / 2 / 8 | 3.0 | 7.5 | REVISE, 5 |
| | B | 4,553 | FAIL: no type, 2 untitled ts, "still" ×3, 4 long tables | 98 / 6 / 9 | 2.5 | 5.0 | REVISE, 12 |
| | C | 728 | ok | 30 / 1 / 3 | 1.5 | 4.0 | REVISE, 2 |
| Tasks and boards | A | 746 | ok | 33 / 1 / 5 | 3.0 | 4.0 | REVISE, 4 |
| | B | 5,798 | FAIL: no type, "now" ×3, "still" ×11, 3 long tables | 56 / 3 / 7 | 2.0 | 4.5 | REVISE, 9 |
| | C | 1,261 | ok | 38 / 1 / 3 | 2.0 | 2.5 | **SHIP**, 2 |
| Workers | A | 831 | ok | 29 / 1 / 4 | 2.0 | 3.5 | REVISE, 2 |
| | B | 4,540 | FAIL: no type, 2 untitled ts, "now" ×3, "no longer", "still" ×4, 2 long tables | 45 / 1 / 5 | 2.0 | 3.5 | REVISE, 8 |
| | C | 1,195 | ok | 48 / 3 / 4 | 2.0 | 3.0 | REVISE, 7 |

| Arm | Wrong claims | Unsupported | Wrong per claim checked | Cold read, page questions /9 | Cold read, all /24 | Editor |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| A | 4 | 17 | 3.5% | 8.0 | 15.0 | 3 REVISE, 11 findings |
| B | 10 | 21 | 4.3% | 6.5 | 13.0 | 3 REVISE, 29 findings |
| C | 5 | 10 | 3.8% | 5.5 | 9.5 | 1 SHIP, 2 REVISE, 11 findings |

The wrong claims, in short (full tables in `evidence/results/*.fact.txt`):

- **A**: `harnesses` imported from the package root, when it is planned for `/kit`; `workspace` given
  as a path string; "a task is only ever claimed once", when a retry or reclaim claims it again;
  "nobody can edit a standard worker from inside the app".
- **B**: three file counts off by one; a kit's reach through `requires` stated too narrowly; an
  incomplete list of the flows an app serves; where a bad kit config is refused; a gap-table row
  saying `defineKit` doesn't exist yet; a retired shape that isn't read; a reference count; the worker-flow contract given as three conditions, when the code
  has four checks.
- **C**: `harnesses` from the package root (it came from my surface note; see below); "only a user
  can retry a task", when app code can too; an org worker's path; the same three-condition contract;
  a `tools:` example the built-in agent would refuse without a tool catalog.

The editor's verdicts on C's first drafts, before the revision, were REVISE on all three pages
(`evidence/c-loop/*.editor.txt`).

## What made it unfair

- **I read arm A before I wrote the cold-read questions.** The page questions track facts A states:
  the researcher's `WORKER.md`, harnesses and `claudeCode`, the block-kind table, `input.deps`, the
  delegate refusal. This favours A, and it is the main reason not to read the cold-read gap as
  settled.
- **My first answer key repeated A's error** about editing a standard worker. I corrected it after
  the fact check and regraded all nine pages with the corrected key.
- **C inherited one error from me.** The planned-surface note I gave the writer
  (`evidence/prompts/c-kit-surface.md`) imports `harnesses` from the package root, the same mistake A
  makes.
- **The five epic questions are book-level.** A page on boards or workers is not meant to define an
  app or a kit, so every arm scores low on them. The page-question column is the fairer per-page
  measure.
- **Unequal revision.** A went through several rounds of review on PR 5126. B had one writer and up
  to two cold readers per doc. C had one writer, one editor pass and one revision.
- **Model.** Every B, C and evaluation agent ran on Opus 5.5. I don't know which model wrote A.
  FIX-2701 plans a smaller model.
- **Noise.** There was one cold reader per page. Gradings of the same answers varied by up to 2.5
  points out of 8, so I report the median of three.
- **Long pages get a shallower check.** B is about six times longer than A or C, and its fact
  checker said it did not check every claim.
- **No type-check.** The copy had no `node_modules`, so no arm's code was compiled. Fact checkers
  and editors read figure descriptions and did not see the figures.
- **Blind in name, not in style.** The evaluators saw shuffled letters, but B is recognisable by its
  shape.

## Arm key

Each page got its own shuffle. Evaluators saw only the letter.

| Page | A | B | C |
| --- | --- | --- | --- |
| What Flow State is | Q | S | P |
| Tasks and boards | S | P | Q |
| Workers | P | Q | S |

So `evidence/results/S-tasks-and-boards.*` is arm A's Tasks and boards page.

## Method

Every sub-agent was a separate `claude -p` session (Claude Code 2.1.322, Opus 5.5) with no
conversation history. Scripts are in `evidence/`.

1. **Isolation.** I copied the repository at the head of PR 5126 (`aa6fbe40`) with `git archive` and
   removed `docs/contributing/docs-revamp/` and `specs/epics/FIX-2696/`. Arm A's text and the epic's
   rationale were not on disk for B or C. Only `pages/figures/blocks.svg` came back, as C's figure
   template. Evaluators used a second copy with the same files removed.
2. **Questions first.** I wrote the cold-read questions and answer key
   (`evidence/prompts/questions.md`) before B or C existed: the five reader questions from
   `specs/epics/FIX-2696/SPEC.md` and three per page.
3. **B.** One agent per topic ran `concept-doc` exactly (`evidence/prompts/b-common.md`): its whole
   read-first list, the `example/CONCEPT.md` bar, the shape, and its own cold read with tool-less
   readers. Planned surface came from the kits specs (FIX-2618 and FIX-2619 to FIX-2629). Each doc's
   process note (`b/*.process.md`) records what its cold readers got wrong.
4. **C.** `evidence/extract.py` cut each B doc to the sections `concept-doc` → "Handing off" allows:
   no why-this-doc, what-this-replaces, naming debates, retired terms, decisions or gap table.
   `docs-writer` got that extract, the writing brief with the pilot examples removed
   (`evidence/prompts/c-brief.md`), and a signatures-only note on the planned kit surface. It was told
   not to read `specs/` or any other draft. Then `docs-editor` reviewed each page, and a fresh
   `docs-writer` revised once from those findings (`evidence/c-loop/`).
5. **Evaluation**, per page and blind (`evidence/eval.sh`):
   - **Fact check:** a read-only agent with the repository copy and the page, checking every claim
     against `packages/` and, for planned surface, the kits specs.
   - **Cold read:** an agent with no tools, run from an empty directory, given only the page and the
     questions. A separate grader with no tools saw only the key and the answers, three times.
   - **Editor:** `docs-editor` with the page inline.
   - **Checker:** `node scripts/check-docs-page.mjs`.
6. **Tally:** `evidence/tally.py`.

Not done: no decision card in `specs/epics/FIX-2696/DECISIONS.md`, because that spec is on PR
5126's branch, which another agent owns. The adopt / don't-adopt call above is the card's content.
