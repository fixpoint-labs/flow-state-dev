# PR reviewer guidance — writing for two audiences

Every PR we open is read by two kinds of reviewer who want opposite things, and a
description written for one of them fails the other.

- A **human** has scarce attention and is the only reviewer who can judge *direction*,
  *scope*, and *whether this was worth building*. Their failure mode is skimming past the
  one decision that actually mattered.
- An **automated reviewer** (Bugbot, Codex, Copilot, Cursor, and friends) has unlimited
  attention and no sense of altitude. It reads every line at the same depth. Its failure
  mode is twenty line-level findings on a document that isn't code — or on code that is
  deliberately throwaway — with the one real finding buried among them.

So a PR description carries **two blocks**, saying different kinds of thing:

| Block | Answers | Authored |
|---|---|---|
| **The reviewer contract** | *What is this artifact, and at what altitude should it be reviewed?* | Pasted verbatim per PR kind (below) |
| **Parts worth reviewing closely** | *Where, in **this** change, should attention go?* | Fresh, every PR |

This file is canonical for both. The spec and epic templates carry their own copies of the
contract text because that's the block that gets pasted; when the *rule* changes, it
changes here.

> **The AI block is a request, not a control.** We don't own those reviewers and can't
> instruct them. What we can do is state the altitude, which measurably raises what comes
> back and costs nothing. When a bot comments off-altitude anyway, that isn't a violation
> to argue with — it's ordinary triage under
> [`orchestration.md`](orchestration.md) → "Spec review: the bar and the convergence rule".

## Parts worth reviewing closely — the per-PR block

**1–3 items. Never a walk of the diff.** If everything is worth reviewing closely, nothing
is, and the section has spent the reviewer's attention without directing it.

Each item names three things:

1. **Where** — the file, the section, or the numbered Decision. Precise enough to click.
2. **The question to answer** — phrased so a reviewer can answer it, not admire it.
   *"Is a filter at the serialization seam the right layer, or does resume belong in the
   store's iterator?"* — not *"please review the streaming design."*
3. **What a wrong answer costs** — a rewrite, a breaking change to a shipped contract, a
   silent data path. This is what earns the reviewer's attention rather than asking for it.

Then, separately and explicitly:

- **Where the author is genuinely unsure.** This is the highest-value line in the whole
  description and the one most likely to go missing, because writing it feels like
  admitting weakness. It is the opposite: it's the only way a reviewer knows which of your
  confident sentences was a coin flip.
- **What is deliberately not here** — a deferred deliverable, a known gap, a decision
  parked for a follow-up. A reviewer who finds it themselves will report it as an
  oversight, and you'll spend a round explaining it was on purpose.

Three failure modes, all common:

- **The exhaustive list.** Nine bullets covering every changed file. Signal-free.
- **Pointing at the safe parts.** Worse than writing nothing, because it actively spends
  attention on the code you already checked twice.
- **Pre-defending.** *"I know the guard looks misplaced, but…"* — that's a comment for the
  thread. Pointing at a weak spot is the point; arguing it away in advance defeats it.

## The three altitudes

The contract differs by what the PR *is*. Pick the row, paste the matching block.

| PR kind | The one question | The human judges | Automated review helps most on | Do **not** report |
|---|---|---|---|---|
| **Spec PR** (`spec/<ISSUE-ID>`, never merged) | Is this the right approach? | The numbered Decisions, scope, whether it's worth building at all | Constraints that would *invalidate* the design, factual errors about the codebase, internal contradictions, a missed dependency | Names, signatures, file layout, local structure, test names, anything Part II left open on purpose, the solution sketch at the line level, and **POC code at all** |
| **Epic PR** (`epic/<name>`, never merged) | Is this body of work worth doing — and does the set overbuild? | The objective, whether it's really N issues or N−1, the cross-cutting decisions | A theme that contradicts another, an issue in the index that doesn't serve the objective, a missing issue the objective implies | Any single issue's approach, architecture, or test plan — anything touching exactly one issue |
| **Implementation PR** (`fix/<ISSUE-ID>`, merges) | Is this correct, and does it match the approved direction? | The implementation decisions and their ramifications, what was subtracted, whether the goal was actually *proved* | Correctness, second paths (BP-035), auth/routing from caller-controllable input (BP-031), legacy-shape tolerance (BP-030), concurrency and null boundaries | Re-litigating a Decision the spec already settled and a human approved; style the codebase has already settled |

**The implementation row is the asymmetry worth noticing.** On a spec or epic PR we are
asking a reviewer to aim *higher* than its default. On an implementation PR we want its
exhaustiveness — that's exactly the reviewer we'd choose for a second-path sweep. The
guidance there isn't "aim lower," it's **"here is where the risk is concentrated, and here
is what was settled upstream so don't reopen it."** A spec PR and an impl PR asking for the
same review is the mistake this table exists to prevent.

## Where each block lives

- **Spec PR** — contract: [`spec-template.md`](spec-template.md) → "For reviewers — what
  this document is", pasted at the top of the description. Parts worth reviewing closely:
  authored in `issue-spec` Step 6, below the contract and above Part I.
- **Epic PR** — contract: [`epic-spec-template.md`](epic-spec-template.md) → "For reviewers
  — what this document is". Parts worth reviewing closely: authored by the `epic-agent`
  when it opens or refreshes the epic PR.
- **Implementation PR** — no template; the block below is the source. Authored in
  `issue-implement` Step 9, alongside the Key Decisions & Ramifications list.

### Implementation-PR contract (paste into the description)

> **How to review this.** This implements an **approved spec**
> ([spec PR](#) · `docs/specs/<ISSUE-ID>.md`), so the approach and the numbered Decisions
> in its §6 are already signed off by a human. Please review the **code against that
> direction**, not the direction itself.
>
> **Most valuable here:** correctness on the second path (the legacy shape, the null
> boundary, the concurrent case, the cancel path), anything deriving an auth or routing
> decision from caller-controllable input, and a behaviour the tests assert *around*
> rather than *on*.
>
> **Already settled upstream:** the approach and every §6 Decision (human-approved — if
> one is wrong, say so as a spec finding and it gets folded back; don't re-argue it inline),
> and the conventions in `docs/contributing/best-practices.md`.
>
> **Parts worth reviewing closely:** *(1–3 items, per this file's rules)*

## Why this is worth the lines

The measured cost of getting it wrong is review rounds. A spec PR reviewed as code draws
exhaustive line-level feedback on a document that is deliberately not a finished design;
every one of those comments still has to be triaged and answered, and volume alone can
consume a two-round budget without producing a single spec-level finding. The contract is
the cheapest intervention we have on that, and *"parts worth reviewing closely"* is the
cheapest intervention we have on a human's attention. Both are a few lines in a
description that gets written anyway.
