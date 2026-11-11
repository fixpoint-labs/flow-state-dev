# Writing brief for the docs revamp

How to write a page for the new docs. Read the three pilot pages first; they are the standard, and
this brief explains what they are doing so the next page can do the same.

- [`pilot/what-flow-state-is.md`](./pilot/what-flow-state-is.md): a Start page
- [`pilot/tasks-and-boards.md`](./pilot/tasks-and-boards.md): a concept page about a mechanism
- [`pilot/workers.md`](./pilot/workers.md): a concept page about a thing the user makes

The voice rules in [`../user-docs.md`](../user-docs.md) all still apply. This brief adds what a page
is for and how it is built.

## The reader

Someone who knows TypeScript and React, has never seen Flow State, and wants their own agent app.
They are reading to decide whether an idea is worth their next ten minutes. They are not looking
anything up. People who look things up use Reference, and so do coding agents.

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

Words are counted without frontmatter, code blocks and figure descriptions.
`scripts/check-docs-page.mjs` counts them.

### The concept outline

1. **Opening**, two short paragraphs, no heading. A situation the reader has been in, then the idea
   in plain words.
2. **A figure**, when the idea has a shape (see Figures).
3. **The smallest working example**, with a few sentences that point at the parts.
4. **Two to five sections**, one per question a reader asks next. Headings are plain statements or
   plain questions: "When a task fails", "Whose worker it is".
5. **What it won't do.** Three bullets at most, stated flat.
6. **Next.** Two to four links, each with a clause saying what the reader gets there.

## The moves

Each rule below has an example from a pilot page and the kind of sentence it replaces.

**Open on the reader's situation.** The framework comes second.

> Some work is a list. Research three competitors, then write the comparison.

Not: "Task board is the building block underneath Parallel Tasks, Supervisor, and Plan and Execute."

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

> The drain runs up to four ready tasks at a time unless you set another limit, and a task is only
> ever claimed once.

Not: "A claim is a single atomic compare-and-set, so two workers never run the same task."

**Give the default and one alternative.** The rest is a link to Reference. "How long the list
lasts" names two storage choices. The page it replaces lists four, with their option names.

**Say what a limit means for the reader.**

> So a board is not a background queue.

**Vary the sentence length.** A short sentence after two long ones. Read the paragraph aloud. If
every sentence lands on the same beat, break one or join two.

**Stop when the point is made.** No closing line that sums up the section.

## What goes to Reference

Move a sentence to Reference when any of these is true:

- It is one of more than three options.
- It describes what happens in a race, a retry, or a crash halfway through.
- It names an error code, a status the reader has not met yet, or a field they do not set.
- A reader would only need it after something went wrong.

Cut a sentence when it says what the framework used to do, why a design was chosen, or how
something is implemented.

## Words

- **Worker** means the named agent a user talks to. A block that a board runs is "the block that
  does the task", even though the option is spelled `workers`.
- **Kit** is a feature an app installs. **Slot** is an opening a kit leaves for other kits.
- **View** is what a screen reads. **Flow**, **action**, **block**, **session**, **resource** keep
  the meanings in [`../glossary.mjs`](../glossary.mjs).
- Define a term the first time it appears on a page, in the same sentence. Every page stands alone.
- The product is "Flow State". Packages are written in code font.
- Model ids in examples: `openai/gpt-6-luna`.

## Figures

Draw a figure when the idea is about position: what contains what, what waits on what, what is
copied per user, what order things happen in. One figure per page is normal. Two is the limit.
Skip the figure when a table or a sentence carries it.

A figure shows one idea, and the page's example appears in it by name (`acme`, `engineering.lead`).

The three pilot figures in [`pilot/figures/`](./pilot/figures) follow the site's drawing system.
Copy one and change it.

- **Canvas:** `viewBox="0 0 920 H"`. Margins of 28. Grow down, never wider.
- **Classes only, no colours.** The site themes them for light and dark.

  | Class | Use |
  | --- | --- |
  | `solid` | The outline of a thing |
  | `dash` | Something that does not last, or a boundary such as "one user" |
  | `thin` | A part inside a thing |
  | `hi` | A rule between rows |
  | `ln` | An arrow or connector, with `marker-end="url(#ah)"` |
  | `hl` | The one thing the figure is about. One per figure. Text on it takes `on-hl` |
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
- Keep the `<style>` block at the top of each pilot SVG. It makes the file readable on GitHub. The
  site's own styles override it.

Look at every figure before committing it:

```bash
S=docs/contributing/docs-revamp/pilot/figures/board.svg
H=$(grep -oE 'viewBox="0 0 920 [0-9]+' "$S" | grep -oE '[0-9]+$')
CH=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux*/chrome | head -1)
printf '<html><body style="margin:0;background:#f0ece1"><img src="%s" width="920"></body></html>' "$(realpath "$S")" > /tmp/light.html
sed 's/@media (prefers-color-scheme:dark){/@media all{/' "$S" > /tmp/dark.svg
printf '<html><body style="margin:0;background:#16150f"><img src="/tmp/dark.svg" width="920"></body></html>' > /tmp/dark.html
for t in light dark; do "$CH" --headless=new --no-sandbox --disable-gpu --hide-scrollbars --allow-file-access-from-files \
  --window-size=920,$((H+20)) --screenshot=/tmp/$t.png /tmp/$t.html 2>/dev/null; done
```

Open `/tmp/light.png` and `/tmp/dark.png`. Check that no text crosses a border, no arrow crosses a
label, and exactly one thing is highlighted.

Under the image, write one italic line: a short caption, then
`Description for the site's Figure:` and a full description for a reader who cannot see it. On the
site these become the `caption` and `description` of `<Figure>`.

## Writing a page, step by step

1. **Collect the facts.** Read the existing page or pages on the topic, the package's exported
   surface, and one example that uses it (`examples/`, `labs/`). Write down, with file and line,
   every fact the page will state. Do not read specs, pull requests or commit messages.
2. **Choose the example.** One concrete scenario with names in it.
3. **Write the opening and the outline** before anything else. If the opening needs a framework
   term to make sense, start again.
4. **Write the page.** Leave out any fact that is not on the list from step 1.
5. **Run the checks.**

   ```bash
   node scripts/check-docs-page.mjs path/to/page.md
   ```

6. **Fact-check** with a fresh agent that has the page and the code and nothing else. It returns
   each claim that is not true, with file and line.
7. **Prose-check** with the `docs-editor` agent.
8. **Read it aloud once.** Fix anything you would not say to a colleague.

## Before you call it done

- The first two paragraphs make sense to someone who has never heard of the framework.
- Every code block would run if pasted, or is plainly a fragment of the one above it.
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

1. **Blocks**: `apps/docs/docs/fundamentals/blocks.md` (keep the first fifth)
2. **Generators and tools**: `apps/docs/guides/building-agents.md`
3. **Composition**: `apps/docs/docs/sequencers/overview.md`, `composing-blocks.md`
4. **Flows and actions**: `apps/docs/docs/fundamentals/flows.md`, `actions.md`
5. **Sessions, items and streaming**: `apps/docs/docs/streaming/overview.md`, `emitting-items.md`
6. **State and scopes**: `apps/docs/docs/fundamentals/state-and-scopes.md`
7. **Resources**: `apps/docs/docs/resources/overview.md`, `storage.md`
8. **Views**: `docs/internal/design/reading-writing-installing.md`, `packages/core/src/flow/defineView.ts`
9. **Capabilities**: `apps/docs/docs/fundamentals/capabilities.md`
10. **Kits and slots**: `docs/architecture/kits.md`, `goals/kits/install-in-any-order/`
11. **Background work**: `apps/docs/guides/background-work.md`
12. **Pausing, resuming and surviving a crash**: `apps/docs/docs/advanced/durable-execution.md`
13. **Coding harnesses**: `apps/docs/docs/tools/coding-agents.md`

The remaining concept pages (Serving flows, Persistence, Auth and tenancy, Models) and the Catalog
follow the same steps.
