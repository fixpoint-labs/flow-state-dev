# Writing user docs

This is the standard for everything published under `apps/docs/` and the API sections of
`packages/*/README.md`. It exists because user docs written by whoever built the feature come out
wrong in a predictable way, and style rules alone don't fix it.

The pages themselves are for someone who knows TypeScript and React, has never seen
flow-state-dev, and wants to get something working. Not for a reviewer, not for a maintainer, and
not for the person who wrote the code.

## The outsider rule

**Write from the outside.** You know what the thing does when you call it. You do not know how it
was built, what it used to do, which bug prompted it, what was argued about in review, or what was
considered and rejected.

That knowledge is the problem. Someone who just spent a day on an implementation has a head full of
rationale, and rationale reads as generosity: it feels like giving the reader more. It isn't. The
reader is trying to call an API, and every sentence defending a design decision is a sentence they
have to skip to get there.

So the fix is structural, not stylistic. **User-facing prose is written by an agent that never had
the implementation context** — see [Who writes them](#who-writes-them) below. If you're holding a
spec and a diff and you write the docs yourself, you will leak, no matter how well you know these
rules.

### Two tests for every sentence

**1. Would this sentence survive if the feature had always existed?**

If it only makes sense to someone who knows what changed, it's diff narrative. Cut it. There is no
"before" for a reader arriving today. Words that signal this: *now*, *no longer*, *still*, *as
well*, *not just*, *has always*, *anymore*.

**2. Does it help the reader do something, decide something, or avoid a mistake?**

If it only makes the design look considered, cut it. "Here's what happens" earns its place. "Here's
why we chose that, and here's the alternative that would have been worse" does not.

A limit is allowed and often necessary. State it flat and move on. Don't argue for it.

## What a section contains

- **What it is**, in one or two sentences, in plain terms.
- **How to call it.** Complete, runnable code. Realistic names.
- **What comes back**, including on failure. Show the actual shape.
- **When you'd reach for it**, if that isn't obvious.
- **What it won't do**, where a reader would otherwise assume it does.

That's the whole job. If a paragraph isn't one of those, it probably shouldn't be there.

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
- Code examples use current model names (`openai/gpt-5.4-mini` for small and fast).
- `sidebar_label` never repeats its category. `Memory > Overview`, not `Memory > Memory`.

The reference example for this voice is `apps/docs/blog/2026-03-06-philosophy.md`.

## Who writes them

Writing and checking need different blind spots, so they're separate agents.

**[`docs-writer`](../../.agents/subagents/docs-writer.md)** writes and updates the pages. It runs in
a fresh context and is given only a surface brief, never a spec, PR, issue, or diff. It derives
behavior by reading the public API and the tests that exercise it.

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
