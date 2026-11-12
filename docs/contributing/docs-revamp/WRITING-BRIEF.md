# Writing brief for the docs revamp

How to write a page for the new docs. Read the three pilot pages first; they set the voice, and
this brief explains what they are doing so the next page can do the same. On depth and figures
this brief wins: the pilots and [`pages/blocks.md`](./pages/blocks.md) predate the
concept/reference contract below, and carry mechanism, a "What it won't do" section and `<style>`
blocks that later pages do not.

- [`pilot/what-flow-state-is.md`](./pilot/what-flow-state-is.md): a Start page
- [`pilot/tasks-and-boards.md`](./pilot/tasks-and-boards.md): a concept page about a mechanism
- [`pilot/workers.md`](./pilot/workers.md): a concept page about a thing the user makes

The voice rules in [`../user-docs.md`](../user-docs.md) all still apply. This brief adds what a page
is for and how it is built.

## The reader

Someone who knows TypeScript and React, has never seen Flow State, and wants their own agent app.
They are reading to decide whether an idea is worth their next ten minutes. They are not looking
anything up. People who look things up use Reference, and so do coding agents.

## Concepts and Reference

The two sections split one topic between them.

- **A Concepts page builds understanding.** It gives the mental model, the idea behind the design
  and why it is built this way, what the reader gets from it, and how this concept fits with the
  others. It shows the concept with SVG figures, more than one where each earns its place, and
  with plenty of short, crisp code examples of the concept in action.
- **Reference holds the detail.** Mechanism, checks, limits, edge cases and option tables go
  there, and the Concepts page links to them. Mechanism here is behaviour a user can observe and
  depend on; how the framework implements it is cut, not moved.

A page that explains how a thing is checked, retried or bounded has left Concepts. Every version
of the pilots did this, so the writing loop has a pass for it (pass 6).

## One page, one type

Every page declares a `type` in its frontmatter. The type fixes its job, its length and its outline.

| Type | Job | Words | Outline |
| --- | --- | --- | --- |
| `start` | Get the reader running or oriented | 800 | What it is, show it, the layers or steps, next |
| `concept` | One idea the reader keeps | 1,500 | Below |
| `catalog` | One thing you can install | 1,500 | What you get, install it, use it, slots it opens, slots it fills and views it serves, change it |
| `tutorial` | One outcome, built start to finish | 2,500 | Numbered steps; every step ends with something the reader can see |
| `recipe` | One task | 800 | Task-shaped title, numbered steps, the finished code |
| `reference` | Exact answers | none | Tables and signatures, no narrative |

Words are counted without frontmatter, code blocks and figure descriptions: the budget is for
prose only. `scripts/check-docs-page.mjs` counts them. A first draft aims well under budget, about
700 words for a concept page, so the review passes have room to add.

### The concept outline

For building a model up part by part, keeping one cast of examples and giving each figure one
claim, follow [`concept-doc`](../../../.agents/skills/concept-doc/SKILL.md) → "Writing rules".
Its shape is for internal model docs; a concept page uses this outline.

1. **Opening**, two short paragraphs, no heading. A situation the reader has been in, then the idea
   in plain words.
2. **The model, in a figure** (see Figures).
3. **The smallest working example**, with a few sentences that point at the parts.
4. **Two to five sections**, one per question a reader asks next. Headings are plain statements or
   plain questions: "When a task fails", "Whose worker it is". Each section shows its idea in a
   short example, and in a figure where the idea has a shape.
5. **What it gets you.** Why the thing exists and why it is built this way: what the reader gets
   by using it that they would not get from plain code. Three or four short points, each one something they can observe, each
   tied to the page's example. It comes after the explanation, so the what is told in one piece
   and the why does not interrupt it. See "Say what it buys the reader" in The moves.
6. **How it fits with the others.** What it sits next to, what it is not, and when to reach for
   the neighbouring concept instead: "A board is not a background queue; Background work is." Exact
   limits are Reference.

   Where our word differs from the industry's, an "If you know ..." section comes straight after the
   opening (see The moves).
7. **Next.** Two to four links, each with a clause saying what the reader gets there. Link to
   pages by the names in "What to write next", as `./kebab-case-title.md`, whether or not they
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
otherwise map our word onto theirs and get it wrong. Candidates in the queue: blocks and "there is
no `agent()`" (Generators and tools), kits against plugins (Kits and slots), views against
queries or selectors (Views), the board against a job queue (Background work).

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
  and not built, against a declaration file written for it that FIX-2705 removes when it
  reconciles the page (ER-8).

`scripts/check-docs-page.mjs` fails a `ts` or `tsx` block with no title. It does not cap how many
examples a page has.

## What goes to Reference

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

## Words

- **Worker** means the named agent a user talks to. A block that a board runs is "the block that
  does the task", even though the option is spelled `workers`.
- **Kit** is a feature an app installs. **Slot** is an opening a kit leaves for other kits.
- **View** is what a screen reads. **Flow**, **action**, **block**, **session**, **resource** keep
  the meanings in [`../glossary.mjs`](../glossary.mjs).
- Define a term the first time it appears on a page, in the same sentence. Every page stands alone.
- The repo retires some everyday words. Say "user" for the signed-in human, never "person", and
  "worker" for someone on a team, never "member". `node scripts/check-retired-terms.mjs` names any
  retired word a page uses, and the pre-push hook runs it.
- The product is "Flow State". Packages are written in code font.
- Model ids in examples: `openai/gpt-6-luna`.

## Figures

Draw a figure when the idea is about position: what contains what, what waits on what, what is
copied per user, what order things happen in. A concept page has at least one, for its model, and
one more for each further idea with a shape. Each earns its place: it shows something a table or
a sentence would not.

A figure shows one idea, and the page's example appears in it by name (`acme`, `engineering.lead`).

Every figure follows one style: the site's drawing system, as its published figures use it
(`apps/docs/docs/fundamentals/state-scopes.svg` and `flow-type-instance-session.svg` are the two
to compare against). Each mark has one meaning on every page:

| Mark | Means |
| --- | --- |
| Hatching (`fill="url(#hatch)"`) | Outlives the request |
| Dashed outline (`dash`) | Lasts one action run |
| The highlighter (`hl`) | The one idea a reader should leave with |

Every figure carries a key that names each mark it uses, as the published figures do. The pilot
figures predate this style; FIX-2701 redraws them.

- **Canvas:** `viewBox="0 0 920 H"`. Margins of 28. Grow down, never wider.
- **Classes only, no colours.** The site themes them for light and dark.

  | Class | Use |
  | --- | --- |
  | `solid` | The outline of a thing |
  | `dash` | Something that lasts one action run. Draw a boundary such as "one user" with `thin` |
  | `thin` | A part inside a thing |
  | `hi` | A rule between rows |
  | `ln` | An arrow or connector, with `marker-end="url(#ah)"` |
  | `hl` | The one idea a reader should leave with, which can be a small part. One per figure. Text on it takes `on-hl` |
  | `lb` | A small capital label: what kind of thing this is |
  | `nm` | A thing's name |
  | `c` | Code, ids, values |
  | `sub` | A quiet second line |
  | `t` | A sentence of explanation, set outside the boxes |

- **Text is monospace and does not wrap.** Break lines yourself. Allow 7.5 units a character for
  `c`, 7.2 for `t`, 6.3 for `sub`, 9 for `nm`. A line must end at least 12 units inside its box.
- **Arrows start and end on a box edge** and run through gaps, never over text.
- **Labels are sentence fragments a reader could say.** No option names unless the page teaches
  them.
- **No hex colours and no `<style>` block.** The site styles every class. The figure lint
  (FIX-2697) fails a figure with either, or with no key.

Each figure starts from a figure brief: the one idea, the parts and their names from the page's
example, and which marks it uses. Render it in light and dark and look at it, then set it beside
the two published figures above: same marks, same weight, same type. Until FIX-2697's renderer
supplies the site's styles, the command below renders a pilot figure from its `<style>` block:

```bash
S=docs/contributing/docs-revamp/pilot/figures/board.svg
H=$(grep -oE 'viewBox="0 0 920 [0-9]+' "$S" | grep -oE '[0-9]+$')
CH=${CHROME:-$(ls -d /opt/pw-browsers/chromium-*/chrome-linux*/chrome 2>/dev/null | head -1)}
[ -x "$CH" ] || echo "no Chromium found: set CHROME to a Chromium or Chrome binary" >&2
printf '<html><body style="margin:0;background:#f0ece1"><img src="%s" width="920"></body></html>' "$(realpath "$S")" > /tmp/light.html
sed 's/@media (prefers-color-scheme:dark){/@media all{/' "$S" > /tmp/dark.svg
printf '<html><body style="margin:0;background:#16150f"><img src="/tmp/dark.svg" width="920"></body></html>' > /tmp/dark.html
for t in light dark; do "$CH" --headless=new --no-sandbox --disable-gpu --hide-scrollbars --allow-file-access-from-files \
  --window-size=920,$((H+20)) --screenshot=/tmp/$t.png /tmp/$t.html 2>/dev/null; done
```

Set `S` to the figure you are checking. Open `/tmp/light.png` and `/tmp/dark.png`. Check that no text crosses a border, no arrow crosses a
label, and exactly one thing is highlighted.

Under the image, write one italic line: a short caption, then
`Description for the site's Figure:` and a full description for a reader who cannot see it. On the
site these become the `caption` and `description` of `<Figure>`.

## Writing a page, step by step

Every page goes through ten passes, in order, and figures go through their own track beside them.
FIX-2697 runs the loop as a workflow script so no pass can be skipped, and keeps a record per page
of each pass and what it found. Until it lands, run the passes by hand and keep the record beside
the page.

```text
 1 fact sheet ─ 2 cold-read questions ─ 3 draft ─ 4 machine checks ─ 5 fact check
                                                                         │
10 owner read ─ 9 cold read ─ 8 revise ─ 7 docs-editor ─ 6 depth pass ───┘
figures:  brief ─ draw ─ render light + dark ─ figure lint ─ compare with two published figures
```

1. **Fact sheet.** A fresh [`docs-writer`](../../../.claude/agents/docs-writer.md) agent writes
   `<page>.facts.md` beside the page: every fact the page will state, with file and line. Its
   sources are the ones ER-9 allows and nothing else: the existing page or pages on the topic, the
   package's exported surface and its doc comments, its tests, `goals/`, and one example that uses
   it (`examples/`, `labs/`). No specs, `docs/internal/`, `CLAUDE.md`, pull requests or commit
   messages. When the page is about something that stores data (workers, boards, sessions, a kit's
   collections), the sheet answers four questions for each stored part: who owns it, who can see
   it, where it is stored, and how many exist. Asking them is how the pilot found that editing a
   standard worker makes the user's own copy.
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
5. **Fact check** by a separate agent that has the page and the code and nothing else. It returns
   each claim that is not true, with file and line.
6. **Depth pass.** For each paragraph, ask: is this the model, or mechanism? Mechanism leaves the
   page and becomes a row on the topic's Reference page (FIX-2699), and the page links to it.
7. **`docs-editor`** checks the prose.
8. **Revise once**, from passes 5 to 7, then run pass 4 again. Take every factual correction and
   every depth finding. Take a prose finding unless it would undo something this brief asks for.
9. **Cold read** by two or more fresh agents with no tools, given only the page and the questions
   from pass 2, as [`concept-doc`](../../../.agents/skills/concept-doc/SKILL.md) → "Checking it
   before you call it done" does. Grade their answers against the key. A question most readers
   miss is a gap in the page, even when the fact check and the editor passed it.
10. **The owner reads** the first two pages of each section, then a sample of the rest.

At cutover, `polish-docs` runs once across all the pages (FIX-2705).

## Before you call it done

- The first two paragraphs make sense to someone who has never heard of the framework.
- The page says why the thing exists, after it has finished saying what the thing is.
- Every code block has its path as a title, and every name in it is imported or declared there.
- Every example type-checks, and no paragraph explains a check, a retry or a limit: those are
  Reference rows the page links to.
- Every figure has a key, no hex colours and no `<style>` block.
- No table has more than six rows.
- No sentence contains *now*, *no longer*, *still*, *deliberately*, *simply*, *just*, *powerful*,
  *seamless*, *robust*, *first-class*.
- No more than two em-dashes on the page.
- Every term is defined where it first appears.
- The page is under its budget.

## Pages that are already the right shape

Use these as models for the types the pilots do not cover.

| Type | Model | Why |
| --- | --- | --- |
| `recipe` | `apps/docs/guides/webhooks-stripe.md` | One task, short, ends with working code |
| `catalog` sub-page | `apps/docs/docs/workforce/standing-rules.md` | Opens on why you would want it; about 1,000 words |
| `catalog` overview | `apps/docs/docs/memory/overview.md` | Opens on a problem the reader has had |
| `tutorial` | `apps/docs/guides/human-in-the-loop.md` | One outcome, built in order |
| `concept` opening | `apps/docs/guides/building-agents.md` | "There isn't one." |

## What to write next

In reading order. Each line names the page and where its facts are today.

1. **Blocks**: `apps/docs/docs/fundamentals/blocks.md` (its opening and the five kinds; the rest is Reference)
2. **Generators and tools**: `apps/docs/guides/building-agents.md`
3. **Composition**: `apps/docs/docs/sequencers/overview.md`, `composing-blocks.md`
4. **Flows and actions**: `apps/docs/docs/fundamentals/flows.md`, `actions.md`
5. **Sessions, items and streaming**: `apps/docs/docs/streaming/overview.md`, `emitting-items.md`
6. **State and scopes**: `apps/docs/docs/fundamentals/state-and-scopes.md`
7. **Resources**: `apps/docs/docs/resources/overview.md`, `storage.md`
8. **Views**: `packages/core/src/flow/defineView.ts` and its doc comments and tests
9. **Capabilities**: `apps/docs/docs/fundamentals/capabilities.md`
10. **Kits and slots**: `docs/architecture/kits.md`, `goals/kits/install-in-any-order/`
11. **Background work**: `apps/docs/guides/background-work.md`
12. **Pausing, resuming and surviving a crash**: `apps/docs/docs/advanced/durable-execution.md`
13. **Coding harnesses**: `apps/docs/docs/tools/coding-agents.md`

The remaining concept pages (Serving flows, Persistence, Auth and tenancy, Models) and the Catalog
follow the same steps.
