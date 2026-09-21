# FIX-1478 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Two destinations, one of which is a verification rather than an edit. The reader-facing surface
here is small on purpose: the coordination patterns this app stops demonstrating are documented
in their own pages, and those pages are unaffected.

## UPDATE · `apps/kitchen-sink/README.md` · the opening paragraph

The subsystem list names `patterns` as something the app integrates. After this change the app
uses one coordination pattern, for one narrow job, which is not what that list is claiming.

> Kitchen sink is a reference app, not a minimal example. It hosts multiple flows, integrates
> every subsystem (DevTool, skills, thinking style, advisor, workforce), and is the place we test
> new features end-to-end. For small, focused, copy-paste-able demos see `examples/`.
>
> The chat agent answers directly or hands work to a workforce — a team of hired seats that
> outlive the turn, working through boards. For coordination that happens inside a single
> request, see the [patterns documentation](../docs/docs/patterns/overview.md); each pattern
> page carries its own runnable example. The one pattern this app still uses is the response
> auditor, which annotates an answer after it is produced.

Two things that sentence pair has to do. It tells a reader arriving cold what kind of coordination
this app demonstrates, in the vocabulary the app itself uses on screen. And it sends the reader
who wants in-request composition somewhere it is actually documented, rather than leaving the
absence unexplained.

The `advisor` and `thinking style` entries stay: both still exist. `patterns` becomes `workforce`
because that is what the app now demonstrates in that slot.

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

No page documents the app's on-screen style menu, so its shortening has no destination. The
end-to-end testing page names a classifier mock, not the list of styles, and is unaffected.

## Publication ownership

FIX-1478 publishes the README edit and runs the response-auditor verification, after the orphan
sweep confirms what actually left. The epic's shared narrative about what the reference app
teaches is not this issue's to write; where this README paragraph overlaps an epic-level draft of
the same opening, reconcile with that draft before publishing rather than editing the line twice.
