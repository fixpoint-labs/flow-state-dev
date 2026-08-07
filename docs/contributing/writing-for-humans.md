# Writing for humans — the fold

Every artifact we produce has two readers with opposite needs. A human is making their
hundredth decision of the day and needs the takeaway. An automated reviewer — and whoever
picks the thread up in three weeks — needs the evidence. We have been writing for the
second reader and charging the first for it.

The fix is **not less reasoning**. Tenet 6 is explicit that an artifact owes the human the
tradeoffs and the decisions, not just the outcome — so one that drops its reasoning is
worse, not shorter. The fix is *ordering* — the same reasoning arranged so a human can
stop reading the moment they have what they need, with the detail one click below for
whoever wants it. That ordering is the **fold**.

This file is the one home for the fold and for the **density** rules below — the
sentence-level half of the same job, since an artifact can be folded perfectly and still
cost three passes to read. Both derive from tenet 6 (readability is an output). The
templates that produce artifacts — [`pr-reviewer-guidance.md`](pr-reviewer-guidance.md),
[`spec-template.md`](spec-template.md), [`epic-spec-template.md`](epic-spec-template.md),
[`agent-brief-template.md`](agent-brief-template.md) — apply these rules and don't restate
them.

## The rule

**1. Size to the change, not to the effort.** Length tracks the size of the decision the
artifact carries, never the work behind it. Four hours of agent time and ninety tool
calls, landing on something a human accepts in a line, is a one-line artifact. Writing at
length to show the work is the largest single source of reading debt.

**2. Above the fold, only what a human needs to act — the problem first.** Three things,
in this order:

- **The problem** — what hurt, in the reader's terms. Nothing that follows can be judged
  without it, so nothing precedes it: not a ref, not a label, not what kind of artifact
  this is.
- **The solution** — what we did about it, in plain terms rather than mechanism.
- **What's asked of you** — the decision, the recommendation, and what it costs if it goes
  the other way. Or, in as many words: *nothing — this follows the approved spec.*

A surface may add above-the-fold blocks of its own after these three, never before them. A
**PR description** adds two — where to aim attention, and the links line — per
[`pr-reviewer-guidance.md`](pr-reviewer-guidance.md) → "The layout".

**3. Below the fold, everything else — collapsed, not deleted.** `<details>` blocks, each
with a `<summary>` naming what's inside, so a reader opens only the one they want. This is
the default everywhere, and it is **always** the form for a comment — PR, review, or issue
— because a comment lands in a threaded timeline, where an uncollapsed second half pushes
every later comment down the page and costs readers who were never its audience.

> *The test: if the reader stops after the first screen, do they have what they need to
> decide — and would anything below it surprise them?*

## Budgets

Above-the-fold word counts. **Ceilings, not targets** — most artifacts should come in well
under.

| Artifact | Above the fold |
|---|---|
| PR body, small change | ~50 — usually the whole body; nothing to collapse |
| PR body, implementation | ~150 |
| PR body, spec or epic PR | ~400 for the problem, the solution and the focus list — the spec doc holds the full case, the body holds enough to judge whether to open it. A diagram or any optional section costs on top, and each has to earn it |
| PR or review comment | ~100 |
| A single review finding | ~40 — the trace and the evidence collapse |
| Linear issue | ~100 — problem, who feels it, outcome |
| Issue spec, Part I (The Case) | ~400 |
| Epic spec, §1 (objective) | ~500 |

Over budget is a signal to **cut**, not to collapse more. A 900-word collapsible is still
900 words someone eventually reads, and the reflex to move rather than delete is how a
fold turns into a filing cabinet.

## What never goes above the fold

- The path to the answer. The conclusion goes up; the derivation goes down.
- Per-file, per-item, per-decision enumerations.
- Verification output, test counts, tool transcripts, quoted evidence.
- Alternatives weighed and rejected — that a simpler one lost is a clause; the analysis is
  below.
- Anything restating the diff. The reader has it.

## What never gets collapsed

Collapsing is for detail, never for news a reader would want and wouldn't think to go
looking for:

- A decision being asked of them.
- A risk, a regression, or a known gap.
- Anything hard to reverse — a migration, a deletion, a new dependency, a contract change.
- Scope that grew beyond what was approved.

**Bad news goes above the fold, short.** A collapsible that buries it is worse than the
long version it replaced.

## Density — one idea at a time

Ordering decides what a reader reaches. Density decides whether they get through it.

The failure isn't long sentences. It's a sentence that makes the reader hold more than one
unresolved thing at once, and it comes from writing with the whole problem already in your
head — every compression obvious to you, none of them obvious to them. Five checks,
applied on a reread rather than while drafting:

1. **One idea per sentence.** Two clauses hung off an em-dash are usually two sentences.
   Split at the joint instead of trimming words; the length was never what made it hard.
2. **Name the thing, don't just number it.** A numbered list is fine where the reader can
   see it. A *reference* to "Decision 3" from another artifact makes them rebuild a map
   they don't have — carry the substance alongside the number: *Decision 3 — the ticket
   replaces `expectAttempt` rather than joining it.*
3. **Unpack noun-stacks into verbs.** "It costs a refactor across a screen merged last
   week, a picker mounted on a page FIX-530 will replace, and a real dependency" is three
   costs wearing one sentence. Give each its own line, each starting with a verb.
4. **Define a term of art at first use, or drop it.** "The partition already has a home"
   reads as settled fact to its author and as a puzzle to everyone else. Say it plainly
   once, then the shorthand is earned.
5. **Cut throat-clearing, keep evidence.** *It is worth noting that* goes. The number
   proving the claim stays — what looks like insider shorthand is often the whole argument
   (two review rounds for a spec PR and twelve for an implementation PR is *why* one triage
   rule can't govern both).

A rewrite that follows these usually comes out shorter, but that's a side effect and never
the goal. None of it licenses cutting a reason (tenet 6), and length is what the budgets
above are for.

**Contract text is carried verbatim.** The reviewer contract in a PR body
([`pr-reviewer-guidance.md`](pr-reviewer-guidance.md)) is the only instruction an external
bot ever receives, so it is copied exactly rather than smoothed.

## Mechanics

GitHub renders `<details>` in PR bodies, issue bodies, comments, and any markdown file
read on GitHub. **The blank line after `</summary>` is required** — without it the
markdown inside won't render.

```markdown
<details>
<summary><b>Why the claim ticket is minted by the board</b> — the seam, and what a caller can't forge</summary>

…detail…

</details>
```

Write the `<summary>` so it can be **skipped from the summary alone**: name the contents,
not "more detail". Nest at most one level.

Collapsing costs the other reader nothing. An automated reviewer fetches the raw markdown,
where a `<details>` block is just text. The fold is a rendering concern for the human and
invisible to the bot — which is why it can be applied to a reviewer contract written
mostly *for* the bot without weakening it.

**Where a surface doesn't render HTML, the ordering still carries the fold.** Linear
documents and issue descriptions are the cases we hit: same above-the-fold content first,
then a `---`, then the detail under a `## Detail` heading. This is why `<details>` belongs
in a **PR body** and not in a spec doc — `docs/specs/<ISSUE-ID>.md` is mirrored verbatim
to a Linear document (BP-037), and a collapsed block there renders as raw HTML. The spec's
own Part I / Part II split is already its fold. Check what a surface renders before
relying on it collapsing; the ordering never needs checking.
