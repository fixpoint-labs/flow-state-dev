# Page brief for the new docs (extract)

This is the writing brief for the new docs, with its example pages removed. The voice rules in
`docs/contributing/user-docs.md` all still apply.

## The reader

Someone who knows TypeScript and React, has never seen Flow State, and wants their own agent app.
They are reading to decide whether an idea is worth their next ten minutes. They are not looking
anything up. People who look things up use Reference, and so do coding agents.

## One page, one type

Every page declares a `type` in its frontmatter (`title`, `type`, `description`).

| Type | Job | Words | Outline |
| --- | --- | --- | --- |
| `start` | Get the reader running or oriented | 800 | What it is, show it, the layers or steps, next |
| `concept` | One idea the reader keeps | 1,500 | Below |

Words are counted without frontmatter, code blocks and figure descriptions.
`node scripts/check-docs-page.mjs <page>` counts them and runs the mechanical checks.

### The concept outline

1. **Opening**, two short paragraphs, no heading. A situation the reader has been in, then the idea
   in plain words.
2. **A figure**, when the idea has a shape.
3. **The smallest working example**, with a few sentences that point at the parts.
4. **Two to five sections**, one per question a reader asks next. Headings are plain statements or
   plain questions.
5. **What it gets you.** Why the thing exists: what the reader gets by using it that they would
   not get from plain code. Three or four short points, each one something they can observe, each
   tied to the page's example. It comes after the explanation.
6. **What it won't do.** Three bullets at most, stated flat.

   Where our word differs from the industry's, an "If you know ..." section comes straight after the
   opening.
7. **Next.** Two to four links, each with a clause saying what the reader gets there. Link to
   pages as `./kebab-case-title.md`, whether or not they exist yet. A concept page may end with one
   link to its Reference page, as `../reference/<topic>.md`.

## The moves

- **Open on the reader's situation.** The framework comes second.
- **Say what it buys the reader.** Once the reader has seen what the thing is, say what they get:
  consequences they can see, in the page's example, without the mechanism. Finish the what first.
- **Say the idea in words you would use out loud.** Introduce the API name afterwards, attached to
  the plain word.
- **Show it, then say what to look at.** Code comes before the paragraph about it. The paragraph
  points at two or three things in the code and stops.
- **One example per page, carried through** the opening, the figure, the code and the later
  sections. Do not introduce a second scenario.
- **State the guarantee. Leave out the machinery.**
- **Give the default and one alternative.** The rest is a link to Reference.
- **Say what a limit means for the reader.**
- **Say where we differ from what the reader already knows**, in a short "If you know ..." section
  near the top, once per page at most: what is the same first, then the one difference and what it
  lets them do. Do not argue for the design or compare products by name.
- **Vary the sentence length.**
- **Only explain what the page shows.** A section about an API needs that API in the page's example.
- **Say a thing once.** A limit stated where it first matters does not come back in "What it won't do".
- **Stop when the point is made.** No closing line that sums up the section.

## Code examples

Every example belongs to one made-up app, laid out like this:

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

- Every code block opens with its path: ` ```ts title="src/flows/research/flow.ts" `. A worker file
  is titled with its path under `workforce/`.
- Every identifier a block uses is imported or declared in that block. Framework names come from
  their package; app names from a relative path in the layout above.
- One export per block file, named after the file.
- A value the caller supplies, such as `userId`, is a function parameter.
- A page does not have to show every file it imports, but says what the imported thing is in a clause.
- Do not reprint a file to change one line.
- A concept page shows four code blocks at most.

## What goes to Reference

Move a sentence to Reference when it is one of more than three options; describes a race, a retry
or a crash halfway through; names an error code, a status the reader has not met yet, or a field
they do not set; or is only needed after something went wrong. Cut a sentence when it says what the
framework used to do, why a design was chosen, or how something is implemented.

## Words

- **Worker** means the named agent a user talks to. A block that a board runs is "the block that
  does the task", even though the option is spelled `workers`.
- **Kit** is a feature an app installs. **Slot** is an opening a kit leaves for other kits.
- **View** is what a screen reads. **Flow**, **action**, **block**, **session**, **resource** keep
  the meanings in `docs/contributing/glossary.mjs`.
- Define a term the first time it appears on a page, in the same sentence. Every page stands alone.
- Say "user" for the signed-in human, never "person", and "worker" for someone on a team, never
  "member". `node scripts/check-retired-terms.mjs` names retired words.
- The product is "Flow State". Packages are written in code font. Model ids: `openai/gpt-6-luna`.

## Figures

Draw a figure when the idea is about position: what contains what, what waits on what, what is
copied per user, what order things happen in. One per page is normal; two is the limit. Skip it
when a table or a sentence carries it. A figure shows one idea, and the page's example appears in it
by name.

Use the site's drawing system. `docs/contributing/docs-revamp/pages/figures/blocks.svg` in the
repository follows it: copy it and change it. Canvas `viewBox="0 0 920 H"`, margins of 28, grow
down. Classes only, no colours: `solid` outline of a thing, `dash` something that does not last or a
boundary, `thin` a part inside a thing, `hi` a rule between rows, `ln` an arrow with
`marker-end="url(#ah)"`, `hl` the one highlighted idea (text on it takes `on-hl`), `lb` small capital
label, `nm` a name, `c` code, `sub` a quiet second line, `t` a sentence of explanation. Text is
monospace and does not wrap (7.5 units a character for `c`, 7.2 for `t`, 6.3 for `sub`, 9 for `nm`;
end 12 units inside the box). Arrows start and end on a box edge. Render it with headless Chromium
(`/opt/pw-browsers/chromium-1243/chrome-linux*/chrome --headless=new --screenshot`) and look at it.

Under the image, one italic line: a short caption, then `Description for the site's Figure:` and a
full description for a reader who cannot see it.

## Before you call it done

- The first two paragraphs make sense to someone who has never heard of the framework.
- The page says why the thing exists, after it has finished saying what the thing is.
- Every code block has its path as a title, and every name in it is imported or declared there.
- No table has more than six rows. No more than two em-dashes.
- No sentence contains *now*, *no longer*, *still*, *deliberately*, *simply*, *just*, *powerful*,
  *seamless*, *robust*, *first-class*.
- Every term is defined where it first appears. The page is under its budget.
