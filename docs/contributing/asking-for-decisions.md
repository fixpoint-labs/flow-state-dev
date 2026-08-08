# Asking for a decision — the engineer and the product owner

You are the engineer. The person you are asking is the **product owner**: they set the
objectives, they hold the roadmap, and they know things about the business you don't. Their
job is the shape of the whole thing — what we're driving at, and whether we're still driving
at it. Not the mechanism.

They are technical. That is a trap, not a licence. A technical product owner *can* follow a
paragraph about lock ordering, which makes it easy to hand them one — and every time you do,
they spend attention re-deriving a call you already made instead of on the objective they're
the only one tracking. **Dropping them into the engineer's chair is a failure of the ask, not
a service to it.** It is occasionally necessary and it should be rare; see "When engineering
detail is genuinely the ask" below.

So the discipline is: **every ask is translated into the decision they are actually making.**
Not "should the guard move above the transaction?" but "do we fix this now and break a
published error code, or document it and fix it at 1.0?" The second is the same decision. It
is answerable by someone who knows what we've promised customers, which is exactly who you're
asking.

This file is canonical for **what an ask contains**. The fold, the budgets, and the density
rules are [`writing-for-humans.md`](writing-for-humans.md); the PR layout that carries an ask
is [`pr-reviewer-guidance.md`](pr-reviewer-guidance.md); the *gates* that make an ask
mandatory are [`orchestration.md`](orchestration.md). Read those for ordering — this one is
about content. [BP-041](best-practices/process.md#bp-041-frame-every-ask-as-a-business-decision)
is the index entry.

## The shape

Six parts. The first four are always there; the last two are what separate an ask that gets
answered from one that gets a clarifying question back.

| Part | What it does |
|---|---|
| **The fork, as the heading** | A plain-language either/or. *"Cross-job corruption: fix it, or document it as best-effort?"* — not a topic, not a component name |
| **Plain terms** | What is happening, in the world rather than in the code. Two to four sentences |
| **The trade-off** | What picking one costs — in customers, promises, time, or reversibility. Not in files touched |
| **My recommendation** | Your position, argued. Always present |
| **What would change my mind** | The specific fact you don't have and they might |
| **What being wrong costs** | Calibration — how much of their attention this deserves |

### The fork, as the heading

Name both options in the heading. A reader who skims four headings should know what four
decisions they're being asked to make and be able to answer the easy ones immediately.

A heading that names a *topic* (`Retry semantics`) makes them read the body to find out
whether they're being informed or asked. A heading that names the *fork* (`Retry semantics:
replay the old job, or re-run against current config?`) is answerable from the table of
contents.

### Plain terms

Describe the behaviour a person would observe. No file paths, no symbol names, no framework
vocabulary (`sequencer`, `scope`, `capability`, `item`) unless you define it in the same
sentence and it's load-bearing for the decision.

The test: **could they explain the problem back to a customer?** If explaining it requires
them to first explain our architecture, it isn't in plain terms yet.

> Background workers pick up jobs from a queue. There's a hole where worker A can write its
> results onto worker B's job. Today, whether we catch that is a coin flip — it depends on
> which order things happen to run in. We thought we were protected; we're not, we just got
> lucky in testing.

That paragraph names no type, no function, and no package, and it is enough to decide on.

### The trade-off

What choosing costs, in their currency. "Closing it means reordering our safety checks, which
changes an error code we've published" is a business cost wearing one clause of mechanism —
the mechanism is there only to make the cost credible. "It requires moving the validation into
the claim path" is mechanism with no cost attached, and it asks them to price it themselves.

Where a cost lands on someone outside the room — a customer, an integrator, a design partner
— say who.

### My recommendation

**Always recommend.** A decision presented as a neutral fork when you already have a view
spends a round extracting the view, and it is not neutrality — it is asking them to do your
job with less information than you have.

Argue it in their terms. *"Silent cross-job corruption is a trust bug — it surfaces to a
customer as 'my results are wrong' and costs days to trace. We're pre-1.0 with essentially no
one depending on that ordering, so this is the cheapest this change will ever be. Deferring
it doesn't make it smaller, it makes it a breaking change later."* Every clause there is
about cost, timing, or who gets hurt. None of it is about code.

Recommending is not deciding. They can overrule it, and a recommendation is what makes
overruling cheap — they push back on a position rather than constructing one.

### What would change my mind

**This is the load-bearing part, and it's the one that goes missing.**

It converts a technical question into a question they are uniquely qualified to answer. You
know the code; they know what we've told customers, which design partners are building
against what, and what the next two quarters need. Naming the fact that would flip your
recommendation tells them exactly which of their knowledge to check.

> **What would change my mind:** if you've told anyone the API is stable, or there's a design
> partner building against these error codes today. Then we document the gap and fix it at
> the 1.0 boundary.

They can answer that in one word. Without it, they have to guess which parts of their context
are relevant to a decision framed in yours.

If you genuinely can't name one — nothing they could know would move you — say so, and the
ask is probably not an ask. Decide it and note it (see "When not to ask" below).

### What being wrong costs

Tell them how much thought it deserves. Three asks that look equally weighty get equal
attention, and the cheap one steals it from the expensive one.

> **Cost of being wrong here: near zero.** This is the one where I'd just take your gut.

The inverse matters more: when a call is expensive to reverse — a shipped contract, a
migration, a public format — say that plainly. It's the difference between a considered
answer and a fast one, and only you can see which this is.

## When engineering detail is genuinely the ask

Rare, and it has a test: **the decision changes depending on a technical fact, and no business
framing survives the translation.** Usually this is a coherence call — two defensible shapes,
both fine commercially, where the choice sets the pattern everything after it copies
(`philosophy.md` → "When tenets collide").

When it happens:

- **Say that it's happening**, in one line: *"This one is genuinely an engineering call and I
  need you in that chair for a minute — here's why the business framing doesn't decide it."*
- **Give the minimum vocabulary**, defined at first use, and no more.
- **Still recommend, and still say what would change your mind.** The shape doesn't change;
  only the register does.

Two rounds of this in a week is a signal to check whether they're really engineering calls or
whether the translation is being skipped.

## When not to ask at all

Asking is not free — it costs their attention and it costs a round-trip. Don't ask when:

- **It's the implementer's call.** Names, layout, which helper, local structure. That's the
  spec-review bar in [`orchestration.md`](orchestration.md) → "Spec review", and it applies to
  conversation too.
- **The answer is derivable.** From the spec, the tenets, the code, or a decision they already
  made. Cite it and proceed.
- **It's a coin flip with near-zero cost either way.** Decide, and note the call in one line
  where they'd see it. A decision surfaced *as a decision* implies weight it doesn't have.
- **You'd take their answer either way but haven't formed a view.** Form one first. An ask with
  no recommendation is usually an ask that isn't ready.

The failure runs both directions. Under-asking hides a call that shapes the product; over-asking
trains them to skim, which costs you the one they needed to read.

## Batching

Group the asks for one turn under a single **`Need your sign-off`** heading, numbered, hardest
first. Two to four is a normal batch. Past four, either some of them aren't asks or the work
went too long without checking in.

That count is a **turn's batch**, and it is not the per-artifact cap. A spec or a PR surfaces
**zero to two live forks** — the ones that get the full six-part shape — while everything else
in its §6 is being ratified at one line each. A turn can carry four asks because they come from
four different places; one artifact asking four times means its direction isn't settled.

Each item is self-contained — they will answer #3 without re-reading #1.

## Where this applies

| Surface | Where the ask lives |
|---|---|
| **Conversation** | A `Need your sign-off` block, when you hit a fork or reach a gate |
| **Spec** | §6 Decisions is the sign-off surface; a **live fork** among them gets the full shape, and §12 open questions always do ([`spec-template.md`](spec-template.md)) |
| **PR description** | Block 3, *What's asked of you* ([`pr-reviewer-guidance.md`](pr-reviewer-guidance.md) → §3) |
| **A gate** | The spec-approval and epic-objective gates, surfaced by the lifecycles ([`orchestration.md`](orchestration.md) → Gates) |
| **A blocker** | A worker escalating a fork it can't settle — the escalation carries the parts, the coordinator surfaces them |

**Most decisions are not live forks.** A spec's §6 lists up to eight Decisions and the human
is *ratifying the direction* on most of them — those stay one line each with a cost column,
which is what makes eight of them fit on a screen. The full six-part shape is for the one or
two that are genuinely open, plus anything in §12. Applying it to all eight buries the live
ones; applying it to none leaves them to be found.

## Worked example

Three asks from one turn. They're deliberately different lengths — the shape scales down, and
the third one is mostly its calibration line.

---

> ## Need your sign-off
>
> ### 1. Cross-job corruption: fix it, or document it as best-effort?
>
> **Plain terms.** Background workers pick up jobs from a queue. There's a hole where worker A
> can write its results onto worker B's job. Today, whether we catch that is a coin flip — it
> depends on which order things happen to run in. We thought we were protected; we're not, we
> just got lucky in testing.
>
> **The trade-off.** Closing it means reordering our safety checks, which changes an error code
> we've published. Anyone who wrote code branching on our specific error ordering would see
> different behaviour.
>
> **My recommendation: fix it.** Silent cross-job corruption in a job system is a trust bug —
> it surfaces to a customer as "my results are wrong" and costs days to trace. We're pre-1.0
> with essentially no one depending on that error ordering, so this is the cheapest this change
> will ever be. Deferring it doesn't make it smaller, it makes it a breaking change later.
>
> **What would change my mind:** if you've told anyone the API is stable, or there's a design
> partner building against these error codes today. Then we document the gap and fix it at the
> 1.0 boundary.
>
> ### 2. Retry semantics: replay the old job, or re-run against current config?
>
> **Plain terms.** When a background job fails and retries, we need "how to re-run this." Two
> designs: save those instructions when the job is accepted, or rebuild them when it actually
> retries. The spec picked rebuild-later; the epic plan had said save-upfront.
>
> **Why it's a product question, not a technical one.** If someone edits a flow between a job
> being accepted and it retrying, save-upfront replays the original definition. Rebuild-later
> runs the new one.
>
> **My recommendation: rebuild-later** (ratify the spec). Our users iterate on flows
> constantly. The overwhelmingly common case is: flow was broken, user fixed it, user hits
> retry — and they want the fix. Replaying the original is the audit/compliance behaviour, and
> we're not selling that yet.
>
> **What would change my mind:** if you see FSD used where a retry has to be provably identical
> to what was accepted — regulated workloads, billing, anything where "we re-ran it
> differently" is a problem.
>
> ### 3. Epic close-out: drop a gate, or reopen deferred work?
>
> **Plain terms.** Our own "this epic is done" checklist includes a task that can't start,
> because it depends on work you deliberately postponed yesterday. As written, the epic can
> never be marked complete. It's a bookkeeping deadlock, not a technical one.
>
> **My recommendation: drop it from the done-criteria.** Nothing technical hangs on it, your
> deferral was right, and nothing has changed since. Both pieces stay filed and get picked up
> together later.
>
> **Cost of being wrong here: near zero.** This is the one where I'd just take your gut.

---

What that example never does: name a file, name a type, quote an error code, cite an issue ID
in the body, or explain how a queue works. Every one of the three is answerable by someone
whose job is the roadmap. That's the bar.
