# FIX-1478 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Three destinations, one of which is a verification rather than an edit. The reader-facing surface
here is small on purpose: the coordination patterns this app stops demonstrating are documented
in their own pages, and those pages are unaffected.

## UPDATE · `apps/kitchen-sink/README.md` · the opening paragraph

The subsystem list names `patterns` as something the app integrates. After this change the app
uses one coordination pattern, for one narrow job, which is not what that list is claiming.

> Kitchen sink is a reference app, not a minimal example. It hosts multiple flows, integrates
> every subsystem (DevTool, skills, thinking style, advisor, workforce), and is the place we test
> new features end-to-end. For small, focused, copy-paste-able demos see `examples/`.
>
> The chat agent either answers in the turn or files the work to a durable board, where a child
> session picks it up and the result comes back on a later turn. For coordination that happens
> inside a single request, see the [patterns documentation](../docs/docs/patterns/overview.md);
> each pattern page carries its own runnable example. The one pattern this app still uses is the
> response auditor, which annotates an answer after it is produced.

Two things that sentence pair has to do. It tells a reader arriving cold what kind of coordination
this app demonstrates, in the vocabulary the app itself uses on screen. And it sends the reader
who wants in-request composition somewhere it is actually documented, rather than leaving the
absence unexplained.

**Say board and child session, not workforce.** `pipelines/background-work.ts` builds an
orchestration `taskBoard` whose worker is a `dispatcher` into a child session. It imports nothing
from `@flow-state-dev/workforce` and addresses no hired seat, and the published overview is
explicit that *a task's `assignee` never names a hired worker* and that *Workforce does not staff
a task board*. A draft of this paragraph called it a hand-off to a team of hired seats; that was
wrong, and it is the kind of wrong a reference app's README propagates. What makes this the
honest durable recipe on the screen is the **lifetime** — the work outlives the reply — not who
runs it.

The app's hired seats are real and separate: four support-desk workers under `workforce/teams/`,
which the roster surfaces show. The README's `workforce` subsystem entry is about those, and it
stays. `patterns` leaves that list, because after this change the app uses one pattern for one
narrow job rather than integrating the subsystem.

## VERIFY, no change · `apps/docs/docs/patterns/response-auditor.md` · "Shipped analyzers"

That page shows this app's bias-analyzer adapter as its worked example, introduced with *"The
kitchen-sink reference app shows this pattern"*. That sentence stays true — the response audit is
the one surface keeping its pattern, and its behaviour does not change.

**This is a check, not an edit.** The snippet on the page and the file it describes must still
agree after the change; confirm it in the same pass and correct the snippet only if the file has
drifted for an unrelated reason. It is recorded here because it is the one published page that
would have been silently falsified had the audit gone the other way.

## No other documentation impact

The published pages for the coordination patterns this app stops using — supervisor, debate,
plan-and-execute, routed specialists, event actors — do not reference the reference app. Each is
self-contained, with its own example, and each pattern remains supported and shipped. Nothing on
those pages becomes untrue, so nothing on them changes.

No page documents the app's on-screen style menu, so its shortening has no destination.

`intentClassifier`'s own pages — `patterns/utility-blocks/core.md` and `fundamentals/blocks.md` —
are unaffected. The utility ships and is documented on its own terms; this app simply stops being
one of its consumers.

## UPDATE · `apps/docs/docs/testing/end-to-end-tests.md` · the mock inventory

One line lists the mocked generators on the chat-agent's run path:

> The other generators on the run path (`thinkingStyleClassifierMock`, `skillClassifierMock`,
> `autoTitleMock`) use the framework's `mockGenerator()` …

`thinkingStyleClassifierMock` goes with the classifier it mocks ([D4](DECISIONS.md#d4)), so drop
it from that list and leave the other two. Small, and easy to miss: the mock is registered under a
string key, so nothing fails when the block it stands for is deleted. It is named in the plan's
orphan table for the same reason.

## Publication ownership

FIX-1478 publishes the README edit and runs the response-auditor verification, after the orphan
sweep confirms what actually left. The epic's shared narrative about what the reference app
teaches is not this issue's to write; where this README paragraph overlaps an epic-level draft of
the same opening, reconcile with that draft before publishing rather than editing the line twice.
