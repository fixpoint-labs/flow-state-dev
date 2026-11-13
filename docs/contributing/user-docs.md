# Writing user docs

This is the standard for everything published under `apps/docs/` and the API sections of
`packages/*/README.md`. It exists because user docs written by whoever built the feature come out
wrong in a predictable way, and style rules alone don't fix it.

The pages themselves are for someone who knows TypeScript and React, has never seen
flow-state-dev, and wants to get something working. Not for a reviewer, not for a maintainer, and
not for the person who wrote the code. On a Start or Concepts page they are reading to decide
whether an idea is worth their next ten minutes, not looking anything up. People who look things
up use Reference, and so do coding agents.

The voice half of this standard (the outsider rule, the tells, the voice) holds for every user
doc today. The page half ([page types](#page-types-and-budgets) through
[before you call it done](#before-you-call-it-done)) holds for the pages under
`docs/contributing/docs-revamp/pages/` now, and for every page under `apps/docs/` from the
revamp's cutover on. A page that fits no type is a change to this standard, not an exception to
it. The figure rules live beside it, in [`user-docs-figures.md`](./user-docs-figures.md).

## The outsider rule

**Write from the outside.** You know what the thing does when you call it. You do not know how it
was built, what it used to do, which bug prompted it, what was argued about in review, or what was
considered and rejected.

That knowledge is the problem. Someone who just spent a day on an implementation has a head full of
rationale, and rationale reads as generosity: it feels like giving the reader more. It isn't. The
reader is trying to call an API, and every sentence defending a design decision is a sentence they
have to skip to get there.

So the fix is structural, not stylistic. **Published user-facing prose is reconciled by
an agent without the implementation rationale** — see [Who writes them](#who-writes-them).
A spec names only the pages that change (`SPEC.md`'s docs line); the prose is written at
implementation, against what shipped. An older spec set's `DOCS.md` draft is input to that
pass, not permission to copy unverified promises into live docs.

### Two tests for every sentence

**1. Would this sentence survive if the feature had always existed?**

If it only makes sense to someone who knows what changed, it's diff narrative. Cut it. There is no
"before" for a reader arriving today. Words that signal this: *now*, *no longer*, *still*, *as
well*, *not just*, *has always*, *anymore*.

**2. Does it help the reader do something, decide something, or avoid a mistake?**

If it only makes the design look considered, cut it. "Here's what happens" earns its place. "Here's
why we chose that, and here's the alternative that would have been worse" does not.

A limit is allowed and often necessary. State it flat and move on. Don't argue for it.

When the reader must act on a change, that goes on the release's Upgrading page
([`release-docs.md`](./release-docs.md#the-upgrading-page)), not on this one. Keep it to the
action and its consequences, not design history.

## What a section contains

- **What it is**, in one or two sentences, in plain terms.
- **How to call it.** Complete, runnable code. Realistic names.
- **What comes back**, including on failure. Show the actual shape.
- **When you'd reach for it**, if that isn't obvious.
- **What it won't do**, where a reader would otherwise assume it does.

That's the whole job. If a paragraph isn't one of those, it probably shouldn't be there.

A `concept` page follows [the concept outline](#the-concept-outline) instead of this list. Its
limits and failure shapes are Reference rows it links to, so it has no "What it won't do"
section; see [Concepts and Reference](#concepts-and-reference).

Guarantees are fair game, mechanisms usually aren't. A reader needs to know the answer is accurate
at the moment of the write. They don't need to know it's computed inside the same critical section.
State the promise the reader can rely on, not the code that keeps it.

## The tells

Every example below is drawn from real prose in this repo's published docs. This is what leaking
looks like in practice.

| Tell | Real example | Why it fails | Instead |
|------|--------------|--------------|---------|
| **Diff narrative** | "The call still tells you it was refused" · "both methods behave exactly as they always have" · "Assignment is refused on a terminal task too, not just status changes" | The reader has no before-state to contrast against | Describe the behavior: "A refused write returns …" |
| **Design defense** | "That is deliberate: reporting a refusal and acting on one are separate concerns" | Argues with a reviewer who isn't reading | State the behavior the rationale implies, or cut |
| **Defect narrative** | "A `{ ok: true }` there would have it narrate 'I've reassigned that to the backup researcher' and move on, with a hole in the plan" | This is the bug report, not the docs | Cut. The reader never saw the bug |
| **Counted preamble** | "Two things to know." · "Three answers." · "One honest limit." · "There is a third possibility, and you have to ask for it." | Announcing a count before listing is the clearest AI tell we produce | Say the things |
| **Emotional coaching** | "This matters more than the wording suggests." · "which is why you can trust it" | Tells the reader how to feel about the API | Show the behavior and let them judge |
| **Mechanism as reassurance** | "produced inside the same atomic write that made the decision" · "would race the write you are asking about" | Internals offered as proof of quality | Give the guarantee, drop the machinery |
| **Anticipated objection** | A paragraph answering a question no reader asked, usually starting "Deriving the same answer yourself…" | Written to a reviewer's raised eyebrow | Cut |
| **Significance tic** | *deliberate* / *deliberately*, three times on one page · *by construction* · *load-bearing* · *honest* | Vocabulary from design review | Drop the adverb; the sentence is usually fine without it |
| **Em-dash default** | Eleven across 47 added lines in one change | Reads as machine-generated more than any single word choice | Comma, period, or restructure |

## Voice

Engineers, writing to engineers. Warm, not chatty. A teammate walking you through it.

- Short sentences, varied rhythm. Don't let every sentence land on the same beat.
- No marketing adjectives: *powerful*, *seamless*, *frictionless*, *first-class*, *robust*.
- No "X isn't just Y, it's Z". No lists of three that escalate.
- Don't open sentences with "This" as a bare subject.
- Don't close every section on a triumphant one-liner. If a point lands, it lands.
- Be direct about tradeoffs: "this works for demos, not production" is better than hedging.
- Introduce a term the first time you use it, in plain words.
- No internal issue or PR numbers, ever. Those live in commits, changesets, and `docs/internal/`.
- Code examples use current model names (`openai/gpt-6-luna` for small and fast).
- `sidebar_label` never repeats its category. `Memory > Overview`, not `Memory > Memory`.

The reference example for this voice is `apps/docs/blog/2026-03-06-philosophy.md`.

## Page types and budgets

Every page declares a `type` in its frontmatter. The type fixes its job, its length and its outline.

| Type | Job | Words | Outline |
| --- | --- | --- | --- |
| `start` | Get the reader running or oriented | 800 | What it is, show it, the layers or steps, next |
| `concept` | One idea the reader keeps | 1,500 | [The concept outline](#the-concept-outline) |
| `catalog` | One thing you can install | 1,500 | What you get, install it, use it, slots it opens, slots it fills and views it serves, change it |
| `tutorial` | One outcome, built start to finish | 2,500 | Numbered steps; every step ends with something the reader can see |
| `recipe` | One task | 800 | Task-shaped title, numbered steps, the finished code |
| `reference` | Exact answers | none | Tables and signatures, no narrative |

Words are counted without frontmatter, code blocks and figure descriptions: the budget is for
prose only. [`scripts/check-docs-page.mjs`](../../scripts/check-docs-page.mjs) counts them and
rejects an unknown `type`. A first draft aims well under budget, about 700 words for a concept
page, so the review passes have room to add.

Pages already the right shape, as models for each type:

| Type | Model | Why |
| --- | --- | --- |
| `start` | [`docs-revamp/pilot/what-flow-state-is.md`](./docs-revamp/pilot/what-flow-state-is.md) | The first page of Start |
| `concept`, about a mechanism | [`docs-revamp/pilot/tasks-and-boards.md`](./docs-revamp/pilot/tasks-and-boards.md) | One example carried through |
| `concept`, about a thing the user makes | [`docs-revamp/pilot/workers.md`](./docs-revamp/pilot/workers.md) | Answers who owns each stored part |
| `recipe` | `apps/docs/guides/webhooks-stripe.md` | One task, short, ends with working code |
| `catalog` sub-page | `apps/docs/docs/workforce/standing-rules.md` | Opens on why you would want it; about 1,000 words |
| `catalog` overview | `apps/docs/docs/memory/overview.md` | Opens on a problem the reader has had |
| `tutorial` | `apps/docs/guides/human-in-the-loop.md` | One outcome, built in order |
| `concept` opening | `apps/docs/guides/building-agents.md` | "There isn't one." |

The three pilots set the voice. On depth and figures this standard wins over them: the pilots
and `docs-revamp/pages/blocks.md` predate [the concept/reference contract](#concepts-and-reference)
and carry mechanism and a "What it won't do" section that later pages do not.

## Concepts and Reference

The two sections split one topic between them.

- **A Concepts page builds understanding.** It gives the mental model, the idea behind the design
  and why it is built this way, what the reader gets from it, and how this concept fits with the
  others. It shows the concept with figures, more than one where each earns its place, and with
  plenty of short, crisp code examples of the concept in action.
- **Reference holds the detail.** Mechanism, checks, limits, edge cases and option tables go
  there, and the Concepts page links to them. Mechanism here is behaviour a user can observe and
  depend on; how the framework implements it is cut, not moved.

A page that explains how a thing is checked, retried or bounded has left Concepts. Every version
of the pilots did this, so the writing loop has a pass for it ([pass 6](#writing-a-page-the-ten-passes)).

### What goes to Reference

Move a sentence to Reference when any of these is true:

- It is one of more than three options.
- It describes what happens in a race, a retry, or a crash halfway through.
- It names an error code, a status the reader has not met yet, or a field they do not set.
- A reader would only need it after something went wrong. "The router throws when ..." is
  Reference. "Every route takes the router's input" is the page.

Then link to it. The Concepts page keeps the guarantee in a sentence and points at the row.

Cut a sentence when it says what the framework used to do, how something is implemented, or the
history of a design choice. Why the thing is built this way stays when it is told as the idea
behind it and what the reader gets.

## The concept outline

For building a model up part by part, keeping one cast of examples and giving each figure one
claim, follow [`concept-doc`](../../.agents/skills/concept-doc/SKILL.md) → "Writing rules".
Its shape is for internal model docs; a concept page uses this outline.

1. **Opening**, two short paragraphs, no heading. A situation the reader has been in, then the idea
   in plain words.
2. **The model, in a figure** (see [Figures](#figures)).
3. **The smallest working example**, with a few sentences that point at the parts.
4. **Two to five sections**, one per question a reader asks next. Headings are plain statements or
   plain questions: "When a task fails", "Whose worker it is". Each section shows its idea in a
   short example, and in a figure where the idea has a shape.
5. **What it gets you.** Why the thing exists and why it is built this way: what the reader gets
   by using it that they would not get from plain code. Three or four short points, each one
   something they can observe, each tied to the page's example. It comes after the explanation,
   so the what is told in one piece and the why does not interrupt it. See "Say what it buys the
   reader" in [The moves](#the-moves).
6. **How it fits with the others.** What it sits next to, what it is not, and when to reach for
   the neighbouring concept instead: "A board is not a background queue; Background work is." Exact
   limits are Reference.

   Where our word differs from the industry's, an "If you know ..." section comes straight after the
   opening (see The moves).
7. **Next.** Two to four links, each with a clause saying what the reader gets there. Link to
   pages by their slugs in the page plan, as `./kebab-case-title.md`, whether or not they
   exist yet. One of them is the page's Reference page, as `../reference/<topic>.md`, where the
   detail the page left out lives.

## The moves

Each rule below has an example from a pilot page and the kind of sentence it replaces.

**Open on the reader's situation.** The framework comes second.

> Some work is a list. Research three competitors, then write the comparison.

Not: "Task board is the building block underneath Parallel Tasks, Supervisor, and Plan and Execute."

**Say what it buys the reader.** A page that defines a thing and shows its code has not yet said
why anyone would use it. Once the reader has seen what the thing is, say what they get. Name
consequences they can see, in the page's example, and leave the mechanism out. Finish the what
first: a why placed in the middle of the explanation breaks it in two.

> **A finished block is a checkpoint.** Its output is recorded. On a store that persists, such as
> SQLite or Postgres, a run that dies after `cleanMessage` picks up at `draftReply`. The message is
> not cleaned twice.

Not: "Blocks are typed, composable units." Typed and composable are properties. The reader wants
to know what happens to them because of those properties.

**Say the idea in words you would use out loud.** Introduce the API name afterwards, attached
to the plain word.

> A board is that list, stored, plus the loop that works through it, called the drain.

The reader gets "the loop" first and the framework's word for it second. `board.drain` appears in the
code after that, already explained.

**Show it, then say what to look at.** Code comes before the paragraph about it. The paragraph
points at two or three things in the code and stops.

**One example per page, carried through.** Tasks and boards uses the three competitors in the
opening, the figure, the code and the failure section. Do not introduce a second scenario.

**State the guarantee. Leave out the machinery.**

> The drain runs up to four ready tasks at a time unless you set another limit, and a task never
> runs in two places at once.

Not: "A claim is a single atomic compare-and-set, so two workers never run the same task."

**Give the default and one alternative.** The rest is a link to Reference. "How long the list
lasts" names two storage choices. The page it replaces lists four, with their option names.

**Say what a limit means for the reader.**

> So a board is not a background queue.

**Say where we differ from what the reader already knows.** When our word or our design departs
from what other frameworks do, give it a short section near the top, titled for the reader:
"If you know agents". Start with what is the same, so the reader can keep their mental model.
Then state the one difference and what it lets them do. Do not argue for the design or compare
products by name.

> In most frameworks an agent is one thing: a model, a prompt, some tools, and a loop the framework
> runs for you. A worker can be exactly that, and the ones that come with Workforce are.
>
> The difference is underneath. A worker runs on a flow, and you decide what the flow is.

Use it once per page at most, and only where a reader arriving from another framework would
otherwise map our word onto theirs and get it wrong. Candidates: blocks and "there is no
`agent()`" (Generators and tools), kits against plugins (Kits and slots), views against queries
or selectors (Views), the board against a job queue (Background work).

**Vary the sentence length.** A short sentence after two long ones. Read the paragraph aloud. If
every sentence lands on the same beat, break one or join two.

**Only explain what the page shows.** A section about an API needs that API in the page's example.
If the example has no evaluator, the page gives evaluators one sentence and a link. It does not
describe their options.

**Say a thing once.** If a neighbouring concept is named where it first matters, it does not
come back in "How it fits with the others".

**Stop when the point is made.** No closing line that sums up the section.

## Code examples

Every example belongs to one made-up app, and that app follows the layout we want readers to copy.

```text
fsdev.config.ts                               the app: its kits, flows and stores
workforce/
  teams/<team>/workers/<name>/WORKER.md       one worker
src/
  flows/<flow>/flow.ts                        one flow: defineFlow and its actions
  flows/<flow>/blocks/<block>.ts              one block per file
  flows/<flow>/tools/<tool>.ts                a block a model calls as a tool
  lib/<name>.ts                               client-side helpers
  app/                                        pages
```

- **Name the file.** Every code block opens with its path: ` ```ts title="src/flows/research/flow.ts" `.
  A worker file is titled with its path under `workforce/`.
- **No phantom names.** Every identifier a block uses is imported or declared in that block.
  Framework names come from their package. App names come from a relative path in the layout above:
  `import { analyst } from "./blocks/analyst";`.
- **One export per block file,** named after the file: `blocks/plan-queries.ts` exports `planQueries`.
- **No free variables.** A value the caller supplies, such as `userId`, is a function parameter.
  Do not leave it floating.
- **A page does not have to show every file it imports.** It does have to say what the imported
  thing is, in a clause: "`analyst` and `writer` are blocks ... Each lives in its own file beside
  the flow."
- **Do not reprint a file to change one line.** Show the new file, then say the change in a
  sentence: "In `handleTicket`, `pickReply` takes the place of `draftReply`." "Add
  `tools: [lookUpOrder]` to `draftReply`."
- **Show it in action, often.** A concept page has a short example for each idea it teaches, not
  one long listing. Each example does one thing and is short enough to read at a glance. All of
  them belong to the page's one scenario, so the reader meets the same names throughout.
- **Every example type-checks** against the package source, or, for a surface that is specified
  and not built, against a declaration file written for it that is removed when the page is
  reconciled at cutover.

`scripts/check-docs-page.mjs` fails a `ts` or `tsx` block with no title. It does not cap how many
examples a page has.

## Words

- **Worker** means the named agent a user talks to. A block that a board runs is "the block that
  does the task", even though the option is spelled `workers`.
- **Kit** is a feature an app installs. **Slot** is an opening a kit leaves for other kits.
- **View** is what a screen reads. **Flow**, **action**, **block**, **session**, **resource** keep
  the meanings in [`glossary.mjs`](./glossary.mjs).
- Define a term the first time it appears on a page, in the same sentence. Every page stands alone.
- The repo retires some everyday words. Say "user" for the signed-in human, never "person", and
  "worker" for someone on a team, never "member". `node scripts/check-retired-terms.mjs` names any
  retired word a page uses, and the pre-push hook runs it.
- The product is "Flow State". Packages are written in code font.

## Figures

Draw a figure when the idea is about position: what contains what, what waits on what, what is
copied per user, what order things happen in. A concept page has at least one, for its model, and
one more for each further idea with a shape. Each earns its place: it shows something a table or
a sentence would not.

A figure shows one idea, and the page's example appears in it by name (`acme`, `engineering.lead`).

Every figure follows one visual language, and [`user-docs-figures.md`](./user-docs-figures.md) is
its home: what each mark means on every page, the key every figure carries, the canvas and text
sizes, how to render a figure in light and dark and what to check, the `Figure` markup on the
page, and the lint rules. Read it before drawing. The three marks a writer plans with:

| Mark | Means, on every page |
| --- | --- |
| Hatching | Outlives the request |
| Dashed outline | Lasts one action run |
| The highlighter | The one idea a reader should leave with |

Each figure starts from a figure brief: the one idea, what it adds over the prose, the parts
named from the page's example, and which marks it uses. The revamp's page plan in
[`SITEMAP/`](../../specs/epics/FIX-2696/SITEMAP/README.md) has a brief for every planned figure.

## What a fact sheet may cite

A page states nothing that is not on its fact sheet, `<page>.facts.md` beside the page: every fact
the page will state, with file and line. The sheet cites only what
[`docs-writer`](../../.agents/subagents/docs-writer.md) may read (ER-9):

- the existing page or pages on the topic, and other existing user docs;
- the package's exported surface and its doc comments;
- its tests and `goals/`;
- one example that uses it (`examples/`, `labs/`).

Never `specs/`, `docs/internal/`, `CLAUDE.md`, a pull request or a commit message, whatever a
page plan's Sources line names. One exception, for a surface specified and not yet built: an
approved spec's public names, config keys and import paths, and nothing else from it, each marked
for reconciling at cutover.

When the page is about something that stores data (workers, boards, sessions, a kit's
collections), the sheet answers four questions for each stored part: who owns it, who can see it,
where it is stored, and how many exist. Asking them is how the pilot found that editing a
standard worker makes the user's own copy.

## Writing a page: the ten passes

Every page goes through ten passes, in order, and figures go through their own track beside them.
The page loop runs them: the workflow script `.agents/workflows/page-loop.js`, started with the
page's sitemap id and the writer model (`{ page: "C-07", writer: "sonnet" }`). It writes
`<page>.record.md` beside the page, one section per pass, which CI's record check reads. It never
runs in CI itself; CI checks the record a run left.
A page kept from today's site (one the audit kept because it is already the right size), the
pilots and the pages already drafted are written: they skip pass 3, the draft, and run every other
pass. Pass 1 still lists what the page states, and pass 2 still writes the questions and their
answer key, by an agent that has not read the page, because pass 9 grades against that key. The
record marks pass 3 as skipped and says why; the check accepts that mark only on a page the
sitemap lists as kept, piloted or drafted.

```text
 1 fact sheet ─ 2 cold-read questions ─ 3 draft ─ 4 machine checks ─ 5 fact check
                                                                         │
10 owner read ─ 9 cold read ─ 8 revise ─ 7 docs-editor ─ 6 depth pass ───┘
figures:  brief ─ draw ─ render light + dark ─ figure lint ─ compare with two published figures
```

1. **Fact sheet.** A fresh `docs-writer` agent writes `<page>.facts.md`, citing only
   [what a fact sheet may cite](#what-a-fact-sheet-may-cite).
2. **Cold-read questions**, written before any draft exists, by an agent that has not read one.
   Five or six scenario questions a reader should answer after the page, at least two of them edge
   cases (a failure, a second user, an edit), each with its answer from the fact sheet.
3. **Draft.** Choose one concrete scenario with names in it. Write the opening and the outline
   first; if the opening needs a framework term to make sense, start again. Then write to about
   700 words of prose for a concept page, well under its budget, stating nothing that is not on
   the fact sheet.
4. **Machine checks.** The word budget, the banned words and the code titles
   (`node scripts/check-docs-page.mjs path/to/page.md`), a type-check of every example, balanced
   fences, retired terms (`node scripts/check-retired-terms.mjs`) and the figure lint.
5. **Fact check** by a separate agent that has the page and the code and nothing else
   ([`code-reader`](../../.agents/subagents/code-reader.md): it reads files and runs nothing, as
   pass 6 does). It returns each claim that is not true, with file and line.
6. **Depth pass.** For each paragraph, ask: is this the model, or mechanism? Mechanism leaves the
   page and becomes a row on the topic's Reference page, and the page links to it.
7. **[`docs-editor`](../../.agents/subagents/docs-editor.md)** checks the prose.
8. **Revise**, one round from passes 5 to 7, then run pass 4 again. Take every factual correction and
   every depth finding. Take a prose finding unless it would undo something this standard asks for.
9. **Cold read** by two or more fresh agents with no tools
   ([`cold-reader`](../../.agents/subagents/cold-reader.md)), given only the page and the questions
   from pass 2, as [`concept-doc`](../../.agents/skills/concept-doc/SKILL.md) → "Checking it
   before you call it done" does. Grade their answers against the key. A question most readers
   miss is a gap in the page, even when the fact check and the editor passed it.
10. **The owner reads** the first two pages of each section, then a sample of the rest.

**When a pass sends the page back.** A failing machine check, an untrue claim, a paragraph of
mechanism, a `docs-editor` REVISE and a cold-read question most readers missed each send the page
to pass 8. One revise round is pass 8, then pass 4 again, then pass 7 again if its last verdict was
REVISE. Pass 5 and 6 findings are taken in the first round only. A cold-read gap gets a round, then
a new cold read: fresh readers, the same questions. A page gets at most three rounds, the same three
as [who writes them](#who-writes-them). A page with findings still open after the third is
escalated: pass 9 still runs, and the record lists every round, opens with a `Loop: escalated` line
naming what is open, and has no pass 10. The record check fails it until pass 10 is there: the
owner reads the page, records pass 10 as `Read`, and drops the line. On a page that closed, the loop records pass 10 as
`Not sampled`; the owner rewrites it when they read the page. PR feedback's twelve-round cap is a
different limit and does not apply here.

At cutover, `polish-docs` runs once across all the pages.

## Before you call it done

- The first two paragraphs make sense to someone who has never heard of the framework.
- The page says why the thing exists, after it has finished saying what the thing is.
- Every code block has its path as a title, and every name in it is imported or declared there.
- Every example type-checks, and no paragraph explains a check, a retry or a limit: those are
  Reference rows the page links to.
- Every figure has a key, takes its colours from page tokens (no colour value in the file) and has
  no `<style>` block.
- No table has more than six rows.
- No sentence contains *now*, *no longer*, *still*, *deliberately*, *simply*, *just*, *powerful*,
  *seamless*, *robust*, *first-class*.
- No more than two em-dashes on the page.
- Every term is defined where it first appears.
- The page is under its budget.

## Who writes them

Writing and checking need different blind spots, so they're separate agents.

**[`docs-writer`](../../.agents/subagents/docs-writer.md)** writes and updates the pages. It runs
in a fresh context with a surface brief. For a spec-backed change, the brief also carries
**only the spec's docs line**, the destinations that change (for an older spec set, its
`DOCS.md` draft), not the other spec content, design rationale, PR, issue or diff. It
checks every claim against the public API and behavioral evidence, corrects unsupported
promises, and publishes to the named destinations. A spec merge alone is not evidence the
behavior ships.

**[`docs-editor`](../../.agents/subagents/docs-editor.md)** reviews the prose against this document
and returns findings. It is kept as ignorant of the implementation as the reader is, which is what
makes it useful: an editor who knows the internals reads "produced inside the same atomic write" as
helpful precision. An editor who doesn't reads it as an unexplained internal, which is what the
reader gets.

The caller dispatches the writer, then the editor, and sends findings back to the writer until the
editor returns SHIP. Three rounds, then escalate to a human.

Related: [`add-docs-page`](../../.agents/skills/add-docs-page/SKILL.md) for page placement,
frontmatter, and sidebars. [`polish-docs`](../../.agents/skills/polish-docs/SKILL.md) for
corpus-level restructuring across many pages.
