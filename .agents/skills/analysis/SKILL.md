---
name: analysis
context: fork
agent: general-purpose
model: opus
description: The thoughtful pass, distinct from review. Asks whether this is the right thing, built the right way, given everything we now know — reuse of what we already have, how other frameworks solve it, other shapes it could take, what is new since the last analysis, whether it should exist, and any major concern. Runs at two points — on a drafted spec before the direction gate (forward), and at epic wrap (retrospective). Dispatched by `issue-spec` Step 4.5, `epic-agent` on Create, and `epic-lifecycle` at EPIC_WRAP; runnable standalone on a spec, an epic, or a shipped feature. Not for flaws in the work — that is `review`.
argument-hint: "<spec dir | epic id | feature> [spec | wrap]"
---

# Analysis

**Review looks for flaws in the work. Analysis asks whether it is the right work.**

Where the process runs this:
[`orchestration.md`](../../../docs/contributing/orchestration.md) → "Analysis and review".

| | **Analysis** (this skill) | **Review** |
|---|---|---|
| Question | Is this the right approach, given everything we now know? | Is the work flawed? |
| Posture | Generative, comparative, outward (other frameworks, Linear, the codebase at large) | Critical, inward (the diff, the spec) |
| When | Before the direction gate, and at epic wrap | On a change — a PR, a branch, a diff |
| Output | A verdict and findings that change or confirm the direction | A ranked defect list |

## The objectives

Every analysis answers all seven, in this order. **One line is enough when the answer is
clean** — "nothing to reuse: searched X, Y, Z" is a full answer. Padding is not analysis.

1. **Reuse.** Did we build (or are we about to build) a mechanism we already had? Don't
   search for this yourself. At spec altitude, run [`reuse-review`](../reuse-review/SKILL.md)
   on the spec's *Builds on / Adds* table and read its verdicts (reuse X · extend X ·
   genuinely new). At wrap, read the lessons PR's job audit. Answer with the verdicts that move
   the direction, and link the table. A **reuse** or **extend** verdict on an item the spec
   treated as new is a fold. The rule is
   [`orchestration.md`](../../../docs/contributing/orchestration.md#compose-existing-pieces).
2. **Prior art.** How do other frameworks solve this — at least two, named, with links
   (`WebSearch`). Did any take a materially different approach, and is theirs better on an
   axis we care about? Agent-workflow frameworks first (LangGraph, Mastra, Temporal, Inngest,
   the Vercel AI SDK, CrewAI, …), then whatever the problem's own field uses.
3. **Other shapes.** What else could this be — a different block kind, a different layer, a
   subtraction instead of an addition? See "Alternatives" below for when `adhd` runs.
   Run the **next-variant test** ([`orchestration.md`](../../../docs/contributing/orchestration.md#compose-existing-pieces)
   → "Compose existing pieces"); more than one copied piece is a finding.
4. **New factors.** What has landed or been filed since the last analysis that bears on this?
   Linear issues and features created or changed since the watermark (see "The watermark"),
   merged PRs in the same area, a prior-art change. Name each and whether it moves anything.
5. **Necessity.** Should this exist at all, and at this size? What is the leaner version?
6. **Developer ergonomics.** How many "WTFs" would a developer say on meeting this? Read it as
   a newcomer to the SDK: write the few lines they'd write for the common case (or use the
   spec's diff, if it shows the change in use), starting from their first import. Count what
   they must learn before that code works: entry points, concepts, options. Then name each
   surprise:
   - two things that look like they do the same job
   - a name that doesn't say what the thing does, or breaks the pattern of its siblings
   - something you must know before the obvious thing works
   - an entry point that exists because of how we built it, not because of what the
     developer is doing

   The job check (`issue-spec` question 7) counts the ways to do *one* job. This looks across
   jobs at the whole surface a developer meets. Five separate `create…Client` constructors
   can each pass the job check and still be five things to learn before the first call. A
   surprise the change adds, or makes worse, is a finding. One it only walks past is filed as
   an issue and named in the spec's debt table, *Leaves* row.
7. **Major concerns.** Anything else that would make a senior engineer stop — a promise we
   can't keep, a direction that fights the philosophy, a cost nobody priced. Not line-level
   flaws: those are `review`'s, and a defect you walk into goes in as a routed finding (below).

Read [`docs/philosophy.md`](../../../docs/philosophy.md) first; tenets 2–4 are the yardstick
for objectives 1, 3, 5 and 6.

## Not this skill

| Job | Use instead |
|-----|-------------|
| Flaws in a change: bugs, gaps against the spec, drift, bloat | [`review`](../review/SKILL.md) |
| Whether one change's surface earns its keep | [`second-look`](../second-look/SKILL.md) |
| Each Adds item against existing pieces | [`reuse-review`](../reuse-review/SKILL.md), which objective 1 runs and reads |
| How our *process* did across an epic | [`distill-lessons`](../distill-lessons/SKILL.md) |
| The codebase research a spec is written from | `issue-spec` Steps 2–3 |

## The watermark

Objective 4 needs a "since when". Every analysis records its date, and the next one reads it:

- **Issue spec:** the parent epic's `DECISIONS.md` → *Analysis* date if the issue has an
  epic; otherwise the date the issue was filed.
- **Epic spec:** the most recent wrap analysis comment on another epic in the same Linear
  project, so one epic's wrap feeds the next epic's spec; otherwise the epic issue's creation
  date.
- **Wrap altitude:** the epic's own `DECISIONS.md` → *Analysis* date (the spec-time run).
- **Standalone:** the most recent *Analysis* section or wrap analysis comment on the target,
  else ask the caller for a date.

Query Linear for issues created or updated since the watermark in the same project and under
the same labels, and search them for the job's nouns (follow `CLAUDE.md` → "Linear access"
for the channel). Report how many you looked at, not only the hits.

## Altitude 1 — spec (forward, before the direction gate)

**Dispatched by:** `issue-spec` Step 4.5 for an issue spec; `epic-agent` on **Create** for an
epic spec. The author dispatches it as a **fresh sub-agent** — the analyst never authored the
spec, so it is not anchored on the direction it is judging. That independence is the point.

**Inputs:** the drafted `SPEC.md` and `DECISIONS.md`, the author's research returns (prior
art, internal patterns, the necessity check and its question-7 job list), the Linear issue,
and for an issue under an epic, the epic's retained set. Treat the research as a lead, not
as the answer: check at least one framework the author didn't cite, and get the reuse answer
from a fresh `reuse-review` run (objective 1), not from the author's own search.

**Alternatives.** On an **epic spec**, always run [`adhd`](../adhd/SKILL.md) in its analysis
context — dividing a set into issues is the most expensive shape to get wrong. On an **issue
spec**, run it only when the spec adds new public API surface, a new pattern / capability /
block kind, or a schema or scope decision **and** its *Considered and dropped* weighs no real
alternative. Otherwise objective 3 is answered from the author's research in a line.

**Return** to the author, who disposes of each finding with the BP-040 test — *does acting on
it change the approach?*

- **Yes → fold**: re-draft the affected document before publishing (anti-addenda rule).
- **No → record** it in `DECISIONS.md` → *Analysis*.
- **Only the user can decide it → `DECISIONS.md` → Open**, as a live fork in the six-part
  shape ([`asking-for-decisions.md`](../../../docs/contributing/asking-for-decisions.md)). It
  counts against the sign-off ceiling of three.

Analysis runs during authoring, so it **costs no review rounds**.

## Altitude 2 — wrap (retrospective, at EPIC_WRAP)

**Dispatched by:** `epic-lifecycle` at EPIC_WRAP, once per epic, **after** the lessons worker
returns — it reads that PR's job audit for the reuse question rather than re-running it.

**Inputs:** the merged epic set, the merged child specs, the implementation PRs, the lessons
PR's job audit and ledger rows, and Linear since the watermark.

**The questions turn backward.** Was this a good idea, judged against what we now know? Did
the build hold the approved direction, or drift from it? Would we do it this way again, given
how other frameworks do it and what has been filed since? Did the epic leave a developer with
more to learn or fewer surprises: entry points and concepts before and after? Is there a major
concern the next epic should start from?

**Output:**

1. **A comment on the Linear epic issue** — the verdict first, then one line per objective,
   ~300 words, problem-first ([`writing-for-humans.md`](../../../docs/contributing/writing-for-humans.md)).
   Its date is the next analysis's watermark.
2. **Each concern worth acting on filed through [`issue-manager`](../../../.claude/agents/issue-manager.md)**
   (it dedupes), in the epic's project, linked from the comment. A concern with no issue has
   no owner once the epic closes.
3. **Return** `analysis: <comment link> [N filed]` to the coordinator.

**It never gates the wrap and never reopens the epic.** The code has merged; a concern is
follow-up work, and the issue is how it gets done.

## Output shape (both altitudes)

```
### Analysis — <target> · <YYYY-MM-DD> · watermark <YYYY-MM-DD>

**Verdict:** <Right approach | Right approach, with changes | Reconsider> — <one sentence>.

1. Reuse — <closest existing entry, and why it does / doesn't serve; or "none: searched …">
2. Prior art — <framework: approach, link> · <framework: approach, link> — <what it means for us>
3. Other shapes — <the strongest alternative and why it loses / wins; or adhd's verdict>
4. New factors — <N issues/PRs since the watermark; the ones that move anything>
5. Necessity — <should exist at this size / the leaner version>
6. Ergonomics — <entry points and concepts to learn for the common case; each surprise; or "none: <the code a developer writes>">
7. Concerns — <the major ones; or "none">

| Finding | Objective | Changes the approach? | Disposition |
|---------|-----------|-----------------------|-------------|

**Routed findings** — defects walked into along the way, for `review` or the author.
(Omit if none.)
```

"Right approach" with seven clean lines is a valid and common result. Say it and stop.

## Guardrails

- **Not a review.** Don't list line-level flaws, internal naming, or missing tests. A public name a developer meets is objective 6's. A defect you find
  goes under *Routed findings*, never as an analysis finding.
- **Don't relitigate without a new fact.** At wrap, a decision a human signed off is reopened
  only by something the sign-off didn't have — a new factor (objective 4), a prior-art
  finding, or what the build revealed. Re-arguing the same trade-off is not analysis.
- **A rule from the same epic can't drop an alternative.** An alternative rejected only because
  it contradicts a decision made in the same epic or spec was not *considered and dropped*: that
  decision is part of what is under review. Return it to the user as an *Open* fork.
- **Name things.** "Other frameworks do this differently" without a name and a link is not a
  finding. Neither is "could be cleaner".
- **Read-only.** The analyst edits nothing and files nothing at spec altitude; the author
  disposes. At wrap it files only through `issue-manager` and posts only the epic comment.
- **Model tier:** judgment (Opus). Analysis quality is the whole product.
