# FIX-2380 · Decisions

[Spec](SPEC.md) · **Decisions**

| | Decision | Chosen | Lost |
|---|---|---|---|
| [D1](#d1) | How an app reaches the card | One `review-hold` card, drawn from a task's hold, and by `suspension-card` for a `review` stop that takes a verdict | Each app wiring the card itself; harness-manager naming a `render.component` |
| [D2](#d2) | Who reads the stop's data | harness-manager's `./browser` entry (FIX-2385), beside FIX-2386's `workPlace`; the card takes plain props | The registry card reading harness-manager's field names itself |
| [D3](#d3) | Where Shift Manager turns review on | Its two profiles (`fsd`, `devteam`) pass `reviewChanges: true`; `openLab` stays off by default | Flipping `openLab`'s default |

<a name="d1"></a>
## D1 · One card, two ways in

**Chosen.** `review-hold` is a presentation card. It takes the stop's prompt, an optional
`review` (branch, commits, subjects, judge, as plain props), and an `answer` function. With a
`review` it draws the code review; without one it draws the stop's prompt, which is how a review
that isn't a coding run's (the Claude Code-style lab's thread worker puts the work itself in the
prompt) keeps what it shows today. Either way it offers **Accept** and **Ask for changes**, and
sends only `{ verdict: "accepted" }` or `{ verdict: "revise", words }`.

Teammates and the Claude Code-style lab draw it from a task's hold (FIX-2379's row view; the
hold's `detail` is the stop's data). The registry's `suspension-card` routes a suspension of
`kind: "review"` whose resume schema takes that verdict to the same card, in prompt form, sending
the answer through the app's `SuspensionResolver`. Any other review stop falls to the shape
dispatch, as today. Shift Manager's `AskCard` passes the code review in for a review ask, read
through D2's reader.

**Lost.** Each app wiring the card in its own stop renderer: the next app that draws stops
through `SuspensionCard` would still get a text box the review refuses. Or harness-manager
setting `render.component` on its stop: a Layer 2 package naming a key in an app's renderer map.

**Locks in.** A `kind: "review"` stop that takes a verdict, drawn through `SuspensionCard`, is
answerable with Accept or Ask for changes. `kind` is the optional field `suspendForUser` already
writes on its item; nothing new is added below the registry.

<a name="d2"></a>
## D2 · The stop's data is read in harness-manager's browser entry

**Chosen.** One reader, `reviewDetail(data)` (name the implementer's), exported from
`@flow-state-dev/harness-manager/browser` beside FIX-2386's `workPlace`. It turns the review
stop's data into `{ branch, commits, subjects, judge }`, any field it can't read as unknown,
never a throw. The registry card takes that shape as plain props and spells none of
harness-manager's field names, the same split as FIX-2386's `work-place` chip
([FIX-2386 D3](https://github.com/fixpoint-labs/flow-state-dev/pull/4369), and both specs cite each other): the registry copies files into apps, and a card
that imported harness-manager would put a server package's name into every app that adds it.
Each app calls the reader and passes the result.

**Lost.** The card reading the data itself, this spec's first draft. With FIX-2386 D3, the
browser would have two readers of a coding run's branch and commits, one in `./browser` and one
in `packages/ui` (the FSD Architect's coherence note on this PR).

**Costs.** The registry card waits for FIX-2385's entry to merge, and the reader is added after
it (the epic's ER-4: 2384, 2391 and 2398 add to `./browser` the same way). The card itself and
its `suspension-card` route don't need the reader and can merge first.

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
- **A second answer loses, and says so.** When the filing teammate's steer and the popup's
  answer race, the first lands; the card shows the second's refusal under its buttons, with the
  words kept. No verify leg: the Inbox client's refusal of an answered hold is FIX-2134's, and
  tested there.
- **A changeset for harness-manager** (minor, one sentence: the browser entry reads a review
  stop). The registry ships as source; every app touched is private.

## Notes from review

Round 1 (Codex, Cursor, FSD Architect). Folded: Codex's non-coding review prompt (D1 now draws
the prompt without a `review`, and routes only stops that take a verdict); the Architect's
coherence note against FIX-2386 D3 (D2 flipped to the `./browser` reader). Recorded for the
implementer:

- **Cursor:** route `kind: "review"` before `suspensionShape`, or a review still falls to
  `Question`.
- **Cursor:** on the Inbox client path the answer is `{ value: { verdict, … } }`, as the Claude
  Code-style adapter wraps it; on the resolver path it is the resume `data`.
- **Cursor:** label which goal legs gate the merge (scripted legs, both controls, the `packages/ui`
  unit) and which are on demand (the real commit leg, once); reuse
  `goals/harness-manager/a-runs-changes-wait-for-review/`'s assertions where they overlap.
- **Cursor:** `@flow-state-dev/react`'s `ItemRenderer` has the same shape-only dispatch. Out of
  scope here; a follow-up if an app draws stops without the registry card.
- **Cursor:** keep one exported card both ways in use, so the two paths can't drift.
