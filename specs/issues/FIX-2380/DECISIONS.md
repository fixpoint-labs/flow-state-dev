# FIX-2380 · Decisions

[Spec](SPEC.md) · **Decisions**

| | Decision | Chosen | Lost |
|---|---|---|---|
| [D1](#d1) | How an app reaches the card | One `review-hold` card, drawn directly from a task's hold, and by `suspension-card` for a stop whose `kind` is `review` | Each app wiring the card itself; harness-manager naming a `render.component` |
| [D2](#d2) | Who reads the stop's data and builds the answers | The registry card, against harness-manager's documented data and answer schema | A reader in harness-manager's `./browser` entry (FIX-2385) |
| [D3](#d3) | Where Shift Manager turns review on | Its two profiles (`fsd`, `devteam`) pass `reviewChanges: true`; `openLab` stays off by default | Flipping `openLab`'s default |

<a name="d1"></a>
## D1 · One card, two ways in

**Chosen.** `review-hold` is a presentation card: it takes the stop's data and an `answer`
function, and draws the review. Teammates and the Claude Code-style lab draw it from a task's
hold (FIX-2379's `waitingOn.hold`, whose `detail` carries the stop's data). The registry's
`suspension-card` routes a suspension item whose `kind` is `review` to the same card, sending
its answer through the `SuspensionResolver` the app already provides. Shift Manager's Inbox
draws every stop through `SuspensionCard`, so it gets reviews with no code of its own.

**Lost.** Each app wiring the card in its own stop renderer: Shift Manager would grow an
`AskCard` branch, and the next app that draws stops through `SuspensionCard` would still get a
text box the review refuses. Or harness-manager setting `render.component` on its stop: a
Layer 2 package naming a key in an app's renderer map, which each app would have to register.

**Locks in.** A suspension of `kind: "review"` drawn through `SuspensionCard` is drawn as a
code review. `kind` is the optional field `suspendForUser` already writes on its item; nothing new is added below the registry.

<a name="d2"></a>
## D2 · The card reads the stop's data and builds the answers

**Chosen.** The card reads `{ branch, commits, subjects, judge }` from the stop's data, each
field checked and missing ones read as unknown (as the Claude Code-style lab does today). It
sends only `{ verdict: "accepted" }` and `{ verdict: "revise", words }`, words trimmed and never
blank. These are harness-manager's documented public shapes (its README, *Reviewing a run's
changes*), so the one place an app builds a review answer is the card, as the issue asks.

**Lost.** A reader exported from harness-manager's `./browser` entry. That entry is FIX-2385's,
in another stack, and the registry would then depend on harness-manager for one parse. The
cost of the choice is a second spelling of the field names; a renamed field shows *commits
couldn't be read*, never a crash.

**Would change my mind.** FIX-2385's entry landing first with a review-data reader. Then the
card imports it and its own parse goes.

<a name="d3"></a>
## D3 · Shift Manager turns review on in its profiles, not in `openLab`

**Chosen.** `fsd.fsdev.config.mts` and `fsdev.config.mts` pass `reviewChanges: true`. A person
who opens Shift Manager reviews every coding run that committed.

**Lost.** Flipping `openLab`'s default. Twelve Shift Manager goals open a Lab through it; each
that grades a run settling on its commit would wait on a review nobody answers, or have to
turn the option off.

**Locks in.** A host built on `openLab` that wants review asks for it, as harness-manager's own
default already says.

## Decided, not asked

- **The question box in Teammates is the lab's.** Claude Code-style answers a question through
  its thread composer and Shift Manager through its Inbox card; no second app draws a box for a
  row question. It answers with `answerOne(hold, { text })`.
- **The card keeps a slot for the diff.** FIX-2384 adds its per-file diff there; this issue
  draws none.
- **Teammates' judge is `goalJudge` on the host's default model**, the Claude Code-style lab's
  setup. One judge per harness manager, named after it.
- **A review hold that can't be answered** (its session names no flow) draws the card with its
  reason and no buttons, as `AskCard` does for other stops.
- **No changeset.** The registry ships as source copied into apps; every app touched is private.

## Notes from review

None yet.
