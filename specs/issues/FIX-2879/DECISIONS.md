# FIX-2879 · Decisions

[Spec](SPEC.md) · **Decisions**

The epic already decided the carrier: workforce's `sessionFields` as a keyed slot with a
`written: "turn"` mode, the harness kit's `codeWith`, the respond action's optional `fields`, the
filler that copies the pick into the task, one coder worker in Teammates
([Q-C, ER-5, ER-10, D2](../../epics/FIX-2876/DECISIONS.md#who-owns-what)). Three calls a person
will notice were left to this spec. They are below; the rest is under *Decided, not asked*.

## The tree

```mermaid
flowchart TD
  I["FIX-2879"] --> D1["D1 · a coder named in words is not used · point to Code with"]
  D1 -.->|"rejected: a model would write the pick"| X1["a tool sets the pick from the person's words"]
  I --> D2["D2 · Re-run on a coder moves Code with too"]
  D2 -.->|"rejected: a second writer of a task's coder"| X2["the re-run carries its own coder"]
  I --> D3["D3 · a session no person writes to files on the pick it was opened with"]
  D3 -.->|"rejected: a researcher's task can't ask for code"| X3["refuse coding filings from those sessions"]
  D3 -.->|"rejected: a later pick reaches work in flight"| X4["follow the conversation's current pick"]
```

Solid edges are what you sign. Dashed edges lost, and the label says why.

<a name="d1"></a>
## D1 · A coder named only in words is not used; the teammate points the person to *Code with*

| | |
|---|---|
| **Instead of** | A tool the teammate calls to set the conversation's pick when the person types "have Codex do it" |
| **Because** | The only pick the server trusts is the one the person's own turn sent ([ER-10](../../epics/FIX-2876/DECISIONS.md#who-owns-what), BP-031). A tool the model calls is written by the model: a fetched page, a file or a tool's output that says "use Claude Code" would move a plan-mode conversation onto an edit-capable coder, which is the attack the epic's security review closed. The picker is one click, and it is visible |
| **Locks in** | Lead's prompt rule "assign it to the agent the user names" goes. The harness kit's instruction says that a coding task runs on the conversation's pick, and that a person who names another coder in words is told to pick it in *Code with*. No tool writes `codeWith` |

**What would change my mind:** people mostly switching coder by typing, and ignoring the picker.
Then the teammate offers a one-click *Switch to Codex* the person presses, which writes the pick
through the person's own request, still never through the model.

![D1: a coder named in words is not used, chosen, beside a tool that sets the pick. Decides it: who writes the pick, the person or the model. Price: typing a coder's name no longer switches it. Locks in: no tool writes codeWith. Flips if people switch coder by typing and ignore the picker](figures/d1-words.svg)

It comes down to who writes the pick: a tool means the model does, and so can anything it reads.

<a name="d2"></a>
## D2 · *Re-run on* another coder also moves the conversation's *Code with* to it

| | |
|---|---|
| **Instead of** | The re-run carries its own coder, and the conversation's pick stays as it was |
| **Because** | A task's coder has one writer: the harness kit's filler, from the pick the server holds ([ER-10](../../epics/FIX-2876/DECISIONS.md#who-owns-what)). With one coder worker, *Re-run on Claude Code* can no longer name a worker. So the press writes the pick, through the same person-only action that writes it at open (`setSessionFields`), then refiles. A re-run that carried its own coder would need the board to trust a coder in the refile's body: a second writer, from caller input |
| **Locks in** | `setSessionFields` writes a turn field again whenever the person's request says so; an open field stays write-once. After a re-run, *Code with* shows the coder it ran on, and the next request uses it. The write waits for a turn in flight to end, so it never changes that turn's filings |

**What would change my mind:** people re-running on another coder to compare, and expecting the
conversation to stay on the first. Then the refile takes a coder from the person's own request,
checked as a turn field is, as a second source the filler reads.

![D2: Re-run on a coder moves Code with too, chosen, beside a re-run with its own coder. Decides it: one writer of a task's coder. Price: the conversation's coder changes when you re-run elsewhere. Locks in: setSessionFields rewrites turn fields. Flips if people re-run to compare and expect the conversation to stay](figures/d2-rerun.svg)

It comes down to one writer: a re-run with its own coder is a second way to set one.

<a name="d3"></a>
## D3 · A session no person writes to files coding work on the pick it was opened with

| | |
|---|---|
| **Instead of** | Refusing every coding filing from a session that is neither the person's conversation nor a coding run, or following the conversation's current pick |
| **Because** | ER-10 gives two sources: the person's turn, and a coding run's frozen pair. A researcher's task is neither: it runs outside any coding run, so it has no frozen pair to read, and ER-10's literal text would leave it nothing to file on. The pick its session carried at hand-over is written by the server at filing, from the turn that filed it, and no turn there can change it ([below](#decided-not-asked)). So it is that filing's pick, kept, in the same sense as a run's frozen pair. Following the current pick would let a later pick reach work in flight, which ER-2 forbids for runs. Refusing would leave a researcher who finds a bug unable to ask for the fix |
| **Locks in** | The server resolves a filing's pick by ancestry, in order. **(1) Inside a coding run** (a coding task's session, or any turn that runs inside a coding run): that run's frozen triple (harness, model, plan), as [ER-10](../../epics/FIX-2876/DECISIONS.md#who-owns-what) says, never the kit default. **(2) Descended from a coding run** (a non-coding task a coding run started, directly or through other non-coding tasks): at hand-over the server carries that run's resolved triple into the task session. It wins over any `codeWith` there, and such a filing never falls back to worker or kit, so an extra delegation cannot widen a plan-only parent ([thread](https://github.com/fixpoint-labs/flow-state-dev/pull/5607#discussion_r4667755346)). **(3) Otherwise** (a researcher's delegate session a person's turn opened): the session's carried `codeWith`, which the server wrote at open. **(4) With none:** the worker, then the kit. That is safe: the kit default is chosen by the server, and there is no parent pick to escape. The carried triple is server-written and no filer can set it, like `codeWith` (BP-031). **This amends two epic rows.** [ER-5](../../epics/FIX-2876/DECISIONS.md#who-owns-what)'s "a task session's carried copy is never read for run settings" becomes "never inside a coding run or below one, where the frozen or carried triple is". [ER-10](../../epics/FIX-2876/DECISIONS.md#who-owns-what)'s background-filing rule gains the ancestry step: a filing below a coding run reads the triple the server carried at hand-over, and still never falls back to the kit default; its "never falls back" does not apply to a session with no coding run above it, which reads the carried `codeWith`, then worker, then kit. ER-10 is FIX-2878's row, so **the coordinator's follow-up PR on the epic covers both rows, coordinated with FIX-2878's spec**, opened when this is signed |

Which pick the filler writes, by where the filing comes from
([thread](https://github.com/fixpoint-labs/flow-state-dev/pull/5607#discussion_r4667742949)):

| Filing from | Inside an active coding run? | Below one? | The filler writes | With no pick |
|---|---|---|---|---|
| A person's turn | No | No | That turn's `codeWith` | None: worker, then kit |
| A coding task's session, or any other turn running inside a coding run | Yes | n/a | That run's frozen triple (ER-10) | Never the kit default |
| A non-coding task session a coding run started, directly or through other non-coding tasks | No | Yes | The run's triple, carried by the server at hand-over; wins over any `codeWith` | Never worker or kit |
| A session no person writes to, with no coding run above it, such as a researcher's delegate session | No | No | The session's carried `codeWith`, server-written at open | None: worker, then kit |

**What would change my mind:** long-lived delegate conversations (opened once, messaged for
weeks) filing much coding work. Their pick is the one they were opened with, which can be older
than the person's. Then each message re-carries the sender's pick, which is FIX-1990's to build.

![D3: the pick a session was opened with, chosen, beside refusing those filings and beside following the current pick. Decides it: a researcher's task that needs a code change. Price: a delegate's long-lived conversation keeps an older pick, and epic ER-5's and ER-10's text is amended. Locks in: inside or below a coding run the filler writes that run's triple; otherwise it reads the session's codeWith. Flips if long-lived delegate conversations file much coding work](figures/d3-carried.svg)

It comes down to a researcher's task: refusing it strands the fix, and following the current
pick moves work in flight.

## Decided, not asked

- **The convergence point for the pick.** One writer: the rule `setSessionFieldsAction` already
  applies (the session's own user, on their own conversation, a declared field, a value its
  schema parses, one versioned write), widened so a turn field can be written again. Two entry
  points use it: the respond action's `fields` and `setSessionFields` itself. One reader for
  run settings: the harness kit's filler. Nothing else writes `codeWith`, and no prompt reads it
  for routing.
- **When a turn's fields are written.** When the turn starts, under the conversation's reply
  line, not when the request arrives. A pick sent behind a running turn never reaches that turn's
  filings; the same holds for `setSessionFields` ([D2](#d2)).
- **Where a turn field can be written.** Only on the person's own conversation, as open fields
  today. On a task's, a delegate's, a workstream lead's or a project coordinator's session a
  `fields` entry is refused, naming why, and the message is not stored. Those sessions hold what
  their hand-over carried.
- **A refused field refuses the whole request.** A field not declared, one marked `written:
  "open"`, or a value that doesn't parse: nothing is stored, the message included. The issue's
  acceptance said so.
- **The client's `send` takes `fields`** and sends them only to a door that takes them, read
  the way `doorTakesTask` is. To any other door it rejects before sending, naming the door, so a
  pick is never silently dropped. Teammates shows *Code with* only where the door takes it.
- **No clear.** A pick stays until the person picks again. Picking the app's default harness is
  a pick, so a later change to the default doesn't move that conversation. A clear is one
  nullable value, added when someone asks for it.
- **The model.** Teammates' *Code with* lists the picked harness's models from a new view on the
  harnesses flow, beside readiness, over `Harness.models`. A harness whose list failed offers only
  its default. The model is checked again at claim (FIX-2878's rule); the picker is never trusted.
  FIX-2598 reads the same view.
- **The one instruction** comes from the harness kit's capability, beside `READINESS_GUIDANCE`
  and FIX-2877's default-coder line, and names this conversation's pick, read from the session
  for each turn. It says: a coding task runs on that coder; don't ask which, and don't pick
  another; a coder named in words is picked in *Code with* ([D1](#d1)); a pick marked ✗ files
  nothing, and the person is told what to run or to pick a ready one.
- **One coder worker in Teammates**, `teammates.coder`, unlocked and with no `harness:` line, so
  the kit's `defaultHarness` applies. Tasks in flight on a removed worker at upgrade fail by name.
  Teammates is a lab, so there is no migration; the PR says to finish or cancel coding tasks
  first.
- **No session predates the field** in a way that breaks: one without `codeWith` reads as no pick
  (BP-030).
- **Two PRs, in order.** The package half: the slot and its mode, `fields` on respond and `send`,
  `setSessionFields` rewriting turn fields, `codeWith`, the filler's source, the instruction, the
  model list view, and the Claude Code-style lab's move to `fill`, since the config key goes in
  the same change. FIX-2598 waits only for it ([epic D3](../../epics/FIX-2876/DECISIONS.md#d3)).
  Then the Teammates half: the composer, the model pick, one coder, Lead's prompt, *Re-run on*,
  and the goals.
- **Goals that change with the worker collapse.** `routes-only-to-ready-harnesses` (picks Codex
  instead of typing it), `stops-and-re-runs-a-task-from-its-popup` (*Re-run on* by harness) and
  FIX-2877's `one-default-picks-the-coder` (one worker) are rewritten in the Teammates half.
- **Glossary.** The implementation PR adds *Session field*: a value on a worker session the
  server writes, once at open or again by each of the person's turns. No entry exists today.

## Considered and dropped

| Option | Why it lost |
|---|---|
| A new session-schema slot for turn state (the issue's first framing) | Owner's call, [epic Q-C](../../epics/FIX-2876/DECISIONS.md#decided-in-review): a fourth way to extend session state |
| The pick on the request only, not the session | A turn no person started has no request to read, and a reload would lose it (the owner's "both") |
| A per-teammate default coder | Removed by FIX-2877; the epic's *Decided, not asked* |
| Removing the Claude Code-style lab's `Coder:` line here | FIX-2598's, with its workers ([epic D3](../../epics/FIX-2876/DECISIONS.md#d3)) |

## Open

**Open: none.**

## Analysis

2026-11-23 · watermark 2026-11-23 (the epic merged at `26e76736b`; FIX-2877 and FIX-2878 specs
open as #5606 and #5604). **Inline, by the author:** this dispatch could not start a separate
analyst, so the pass is not independent. The coordinator can run `analysis` on the PR before the
gate.

**Verdict: right approach, with two folds.** *Reuse:* every Adds row extends a piece that
exists; FIX-2598's issue asks for the model list in a package ("the lab keeps no model list the
harness packages could give"). *Prior art:* the epic's pass holds (LangGraph's `configurable`,
Mastra's `RuntimeContext`: request, then default, never message text). *Other shapes:* the epic's
`adhd` pass ran on this design. *New factors, folded:* a coding filing from a non-coding task
session, which the epic didn't name ([D3](#d3)); and *Re-run on*, which names a worker and has no
target after the collapse ([D2](#d2)). *Concern, recorded:* D3's price is left to FIX-1990.
*Counted facts:* the six ways a choice rides a turn, by `grep` across `packages/` and `labs/` at
`26e76736b`; no checker needed.

## How it got here

- **Draft** — framed as the person's half of the epic's goal: `codeWith` as a `written: "turn"`
  session field the respond action writes, the filler's second source, one instruction, a model
  list for the picker, and one coder in Teammates; built on `setSessionFieldsAction`, the
  hand-over carry and FIX-2878's filler.
- **Review round (Gitar, Cursor)** — D3 now names its divergence from epic ER-10 as well as
  ER-5: inside a coding run the frozen pick, never the kit default; outside one the carried
  `codeWith`, then worker, then kit. The epic follow-up covers both rows, with FIX-2878's spec.
  D3 gained a resolution table, and an ancestry step (security review): a non-coding task a
  coding run started carries the run's triple, so delegation cannot widen a plan-only parent.

## Notes from review

- "Worth locking that in the package half explicitly: **no second write module** (epic `sketch.md` floated `writeTurnFields` beside respond). One shared parse/refuse/atomic-write helper keeps the convergence point from becoming two trust models." — cursor ([thread](https://github.com/fixpoint-labs/flow-state-dev/pull/5607#discussion_r4667742936))
- "Consider naming **`doorTakesFields`** (or generalizing the inventory flag) in the Adds table so implementation mirrors `door-task-stamp.test.ts` instead of ad hoc respond wiring." — cursor ([thread](https://github.com/fixpoint-labs/flow-state-dev/pull/5607#discussion_r4667742942))
- "If Teammates and FIX-2598 only need “models for one harness id,” implementation can still **reuse readiness’s fetch/cache/dedup** semantics and avoid fan-out over all harnesses on picker open." — cursor ([thread](https://github.com/fixpoint-labs/flow-state-dev/pull/5607#discussion_r4667742958))
- "**Refused fields**: validate/write before persisting the user line (engine echo ordering vs **Refused** signal)." — cursor ([review](https://github.com/fixpoint-labs/flow-state-dev/pull/5607#pullrequestreview-6024137304))
- "**Client**: omit `fields` when `codeWith` unchanged (already implied by **Reload** goal)." — cursor ([review](https://github.com/fixpoint-labs/flow-state-dev/pull/5607#pullrequestreview-6024137304))

These are inputs, not instructions. Adopt, adapt, or discard; you owe no justification for
discarding one.
