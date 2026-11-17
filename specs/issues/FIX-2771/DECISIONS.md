# FIX-2771 · Decisions

[Spec](SPEC.md) · **Decisions**

One call is the owner's: where Teammates reads worker messages once its own read goes, which adds
a framework view neither the epic nor FIX-2770's spec covers. Everything else follows the epic's
rules and is recorded below so the implementer doesn't re-derive it.

## The tree

```mermaid
flowchart TD
  I["FIX-2771"] --> D1["D1 · a workforce view of the message log"]
  D1 -.->|"rejected · every tab reads the whole log"| X1["every page through the resource hook"]
  D1 -.->|"rejected · one page in random key order"| X2["the hook's first page as it is"]
  I --> E["decided · the roster, context and readiness read existing views"]
  E -.->|"rejected · the ratchet fails a new file"| X3["hook files kept in src/app"]
```

Solid edges are what you sign. Dashed edges lost, and the label says why.

<a name="d1"></a>
## D1 · Teammates' message lines read a new workforce view of the log: one worker's messages, newest first, bounded

| | |
|---|---|
| **Instead of** | Reading every page of the log in the browser, through an option added to react's `useResource` · or `useResource`'s first page as it is |
| **Because** | The log is one user-scope collection keyed by random ids, so a first page is an arbitrary 200, and every page is the whole log, read again by every open tab on every new message, once per worker on screen. A view on the roster flow, which already declares the log, reads it once on the server, sends one worker's newest rows, and is kept current by the same notices. "A missing read goes into the package" is the epic's rule ([ER-1](../../epics/FIX-2683/DECISIONS.md#who-owns-what)); filter before you send (BP-033) and bound what you return (BP-042) |
| **Locks in** | A public view on workforce (`workerMessagesViewRef`, a release note). Teammates shows a worker's newest messages, not its whole history. Shift Manager's Messages screen and FIX-2756 are expected to read the same view rather than a second one |

![Where Teammates reads worker messages: a workforce view of the log, chosen, beside every page through the resource hook. Decides it: what one new message costs. Price: one public view, and old messages past the bound. The row's type is a tie](figures/d1-message-log.svg)

It comes down to one new message: every page means every tab rereads a log that only grows.

**The fork:** do we add a message view to workforce, or teach the generic resource hook to read the whole log?

**In plain terms:** Teammates shows what workers say to each other: a pending reply under a worker's name, a worker's message lines, the popup with what the recipient did. Today each worker on screen re-reads the user's whole message history whenever any message arrives. That read has to leave the app. The question is whether workforce answers "this worker's recent messages", or the browser keeps reading everything through a more general hook.

**The trade-off:** the view is one more public name on a published package, and it shows a worker's newest messages only (the implementer picks the bound, at least 200). The hook option adds no name, but its cost grows with the user's history, in every tab, forever.

**My recommendation:** the view. It is the only option whose cost doesn't grow with history, and it gives Shift Manager's Messages screen (FIX-2775) and FIX-2756 one read to share instead of a second.

**What would change my mind:** Shift Manager's Messages screen needing the whole log with no bound. Then a general every-page hook serves both apps, and the view is one name too many.

**What being wrong costs:** low. Either way the app's own read goes. A view nobody else adopts is a small public name; moving to the hook later is one screen's change.

## Decided, not asked

- **The busy dot moves with the roster** onto workforce's worker sessions view: the default session's `running` and `updatedAt`. Its "running" counts a worker's turns (`TURN_ACTIONS`), where today's read counts every request but the board's `dispatch`: the same for a conversation, and the implementer's test pins it. A seam with FIX-2772 ([SPEC](SPEC.md#where-this-area-ends)).
- **A row's type is the view's.** `AppWorker` becomes `RosterEntry`. A screen works out what it draws (a name from the id, whether a worker takes tasks, whether the user hired it) where it draws it. A type leaves the allowlist for the screen-type list only with a reason (FIX-2769's rule).
- **Writes go through workforce's client** (`hire`, `edit`, `reset`, `fire`) and its input types. Re-check is one direct read of the readiness view with `refresh`.
- **No new file in `src/app/`.** The ratchet fails one, and ER-4 ends the read model. A screen calls the package hook itself; a thin hook, where one earns it, sits beside the screen.
- **The lab's context view moves to `flows/lab-context.mts`,** with its ref beside it, so `src/` imports no `viewRef`. It keeps the delegates it reads off the worker files.
- **The host meets the cap the way claude-code-style's does:** its prose goes to the README's "The host", and it imports `operatorGitHub`, `operatorGitHubToken`, `sqliteScheduleIndex`, `setupCommandFrom` and `checkCommandsFrom` instead of its copies. Prompts stay as they are. `openTeammates` keeps its options, since goals and the contract test import it. A host that still can't fit comments up (the epic's rule).
- **The message view** sits on the roster flow at user scope, beside the worker sessions view. Its rows are the log's own schema, filtered by `from` or `to` on the server, newest first. It is heard on the log's notices, as the collection is. The log's keys carry no worker, so the server reads every page once per change; an index is the fix if that read ever costs a second.
- **The message popup** reads the row's `toSession` through FIX-2772's session hook, never a second feed.
- **The cross-app goals keep their Teammates legs,** repointed from `createAppCalls()` to the hooks rendered under the app's provider; a leg is never retired to make this land.
- **Glossary:** `workerMessagesViewRef` uses no retired word; the implementation PR rechecks `glossary.mjs`.

## Considered and dropped

| Alternative | Why not |
|---|---|
| Keep `workers.ts`, `setup.ts` and `talk.ts` as hook files, claude-code-style's layout | Teammates' `src/app/` is the read model the epic deletes; the ratchet already fails a new file there, and a renamed verb is ER-4's "new verb" |
| Read delegates from FIX-2776's delegate read | Not built yet, and it would put this issue behind a Shift Manager child for four first-run lines |
| Replace Teammates' worker list with workforce's `Roster` component | Changes what a person sees; this epic changes reads, not screens |
| Leave the cap to the closure | The epic signed the cap at 300 with this issue as its owner |

## Settled

- **The 15 entries, and that every allowlist entry has exactly one owner:** **CONFIRMED** by
  `poc/entries/check.mts` on `e90786196b`. It prints 15 for this issue, 22 for FIX-2772, 13 for
  FIX-2773 and 7 no row names, of 57. The configuration is 608 lines (host 397, `fsdev.config.mts`
  66, seven prompts 145), so the host has 89 to fit in. Its control plants an entry nobody owns,
  and the check exits 1 naming it. The premise held.

## Analysis

### Analysis — FIX-2771 spec · 2026-11-17 · watermark 2026-11-17 (FIX-2769 merged)

Run inline by the author (no sub-agent tool here); the cross-spec review may re-run it.

**Verdict:** right approach. It changed one thing: D1 became a view after the hook's first page
was found to be random.

1. **Reuse.** Roster, worker sessions, readiness: **reuse**. Message log: **extend** it with a
   view. Host helpers: **reuse** five exports ([Builds on / Adds](SPEC.md#whats-already-here-and-the-debt)).
2. **Prior art.** The epic's (Relay, Convex): each screen declares what it reads.
3. **Other shapes.** Under *Considered and dropped*.
4. **New factors.** FIX-2769 merged (#5351); FIX-2770's spec merged; no sibling spec PR open.
5. **Necessity.** Yes: leg t needs these entries gone and the cap met.
6. **Ergonomics.** A starter copier meets `useView` and workforce's types.
7. **Concerns.** The busy-dot seam with FIX-2772; shared entries no row owns.

| Finding | Objective | Changes the approach? | Disposition |
|---|---|---|---|
| `useResource`'s first page of the log is random, not recent | 1 | Yes | Folded: D1 is a view |
| No row names `AppCalls`, `AppState`, `Unsubscribe`, `Item`, `steps.ts` | 7 | No | Recorded: SPEC → *Where this area ends* |

## How it got here

- **Draft** — framed as the epic's t1: 15 allowlist entries and the cap. The roster, context and
  readiness read existing views; worker messages need a new workforce view (D1); the host follows
  claude-code-style's.

**Open:** none.
