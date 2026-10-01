# FIX-1667 · Decisions

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

What was considered, what was chosen, why, and what each choice locks in. Three decisions are the
sign-off surface. Everything else here is context for them.

## The tree

```mermaid
flowchart TD
  I["FIX-1667"] --> D1["D1 · the coding-run manager accepts a board a channel holds"]
  D1 -.->|"rejected"| X1["a copy of each row on the channel<br/>can disagree with the run"]
  D1 -.->|"rejected"| X1b["leave the board in the kinds<br/>shift-manager reads a workstream through its channel"]
  I --> D2["D2 · the board is visible to the whole Lab organization"]
  D2 -.->|"rejected"| X2["rows per user, as today<br/>no channel board works that way"]
  I --> D3["D3 · a coding run on a shared board belongs to the person who started it"]
  D3 -.->|"rejected"| X3["the organization owns the run<br/>a bigger manager change, its own issue"]
  D3 -.->|"rejected"| X3b["leave it unstated<br/>a second member's retry forks the run"]
```

Solid edges are what you're signing. Dashed edges lost, and the label says why.

<a name="d1"></a>
## D1 · The fix steps outside the lab once: the coding-run manager accepts a board a channel holds

| | |
|---|---|
| **Instead of** | (a) Staying inside the lab: the kinds keep their own ledger and the lab writes a copy of each row onto the channel's board. (b) Leaving the board in the kinds and having shift-manager read it there |
| **Because** | A channel names its board `<channel>.<board>`, with dots, and the manager refuses any board whose name has a dot, because it builds checkout folders and git branches from that name ([Settled](#settled)). So the one row cannot sit on the channel inside the lab's fence. A copy can: it is two writes that can disagree, and the case where they disagree (a run that failed, a retry) is the case a person opens the board to see. (b) cannot show anything: shift-manager finds a workstream's board through its channel and names nothing from a tree ([FIX-1662 D2](https://github.com/fixpoint-labs/flow-state-dev/pull/2424)). The fence was written before the refusal was known, and the change adds no noun and touches neither `core` nor `engine` (epic [ER-7](../../epics/FIX-1649/BUSINESS-RULES.md)) |
| **Locks in** | A patch release of `@flow-state-dev/harness-manager`, with a changeset. Every board it runs today derives the same checkout folders and branches, so nobody's work moves. Any app's channel board can now back a supervised coding run, each row's run owned by the person who started it ([D3](#d3)), so channel boards become the answer for the next coding Lab too |

![D1: the manager accepts a channel's board, chosen, beside a copy of each row written onto the channel and beside leaving the board in the kinds. Decides it: whether the row shift-manager shows is the row the run settled. Price: a package outside the lab changes. Locks in a patch release with unchanged checkouts; flips if the lab-only fence is held as hard](figures/d1-manager-accepts-channel-board.svg)

It comes down to whether the row shift-manager shows is the row the run settled: a copy can say
*running* after the run failed.

**What would change my mind:** the owner holding the lab-only fence as hard. Then the manager
patch is filed as its own issue that blocks this one, and this issue shrinks to the lab's half.

**What being wrong costs:** a small patch to a published package for one lab's benefit, easy to
reverse, since existing boards derive exactly what they did.

<a name="d2"></a>
## D2 · The board is visible to the whole Lab organization, as every channel's board is

| | |
|---|---|
| **Instead of** | Keeping rows per user, as the kinds' own ledger keeps them today |
| **Because** | A workstream is shared by the people working in it, and a channel's board is kept per organization by the framework ([FIX-1385](https://linear.app/fixpoint-labs/issue/FIX-1385)); there is no per-user channel board to choose. shift-manager reads a board as the reading person's organization |
| **Locks in** | Anyone in the DevTeam Lab's organization sees each row's title, goal, status and assignee. Never the row's input or output: the framework publishes a fixed list of fields to a browser |

![D2: organization-wide, chosen, beside per user. Decides it: whether a workstream shows the same board to everyone working it. Price: every person in the org sees titles and status. Locks in org-wide visibility of row titles and status; flips if a row carries something one org member must not see](figures/d2-org-visible.svg)

It comes down to a shared workstream: per-user rows would show each person a different board.

**What would change my mind:** a DevTeam row that carries something one person in the org must
not see. Nothing in the lab does today.

<a name="d3"></a>
## D3 · A coding run on a shared board belongs to the person who started it

| | |
|---|---|
| **Instead of** | (a) The organization owns the run: any member's retry, recovery or resume continues the same checkout, branch, run record and agent session. (b) Leaving it unstated |
| **Because** | The board is kept per organization (D2), but the manager keeps everything else about a run per person: the checkout folder and the branch carry the person, the run record and the run's questions are kept per person, and a seat's drain runs as whoever sent the work. So (b) is what happens today on a channel board: a second member's retry of the same row starts again in a new checkout on a new branch, without the first attempt's record or agent session. (a) means one person's drain resumes an agent session another person's credentials opened, and moving the run record and questions to the organization changes how the manager isolates runs, which is larger than this issue |
| **Locks in** | On a board kept per organization, the manager records on the row whose run it is, from the resolved identity and never from input (BP-031). Another member's drain does not run that row: it is refused naming whose run it is, charges no attempt, and the row keeps its status until its owner's drain picks it up. The owner's own retry, recovery or resume lands in the same checkout, branch, run record and session. The rule lives in the manager, not in `core` or `engine` |

It comes down to who a coding run on a shared board belongs to: the person who started it, or
anyone in the organization.

**What would change my mind:** the owner wanting a teammate to pick up a stalled run. Then (a) is
filed as its own `harness-manager` issue, and until it lands this rule keeps the run in one piece.

**What being wrong costs:** a row waits while the person who started it is away. Lifting the
refusal later is a small change; a run forked across two checkouts is not undone.

## Decided, not asked

- **The board's local name is `work`.** A name a person reads in shift-manager; any plain name serves.
- **The EM keeps filing through its own board onto the channel's ledger**, not through the
  channel's `fileTask`. The manager requires a row id derived from the issue and phase, and
  `fileTask` mints its own.
- **The cross-flow hand-off and the coder's second declaration stay**, both pointing at the
  channel's ledger. This issue moves only the ledger; the tax has no open owner (FIX-1408 closed with it in place), flagged in the plan's follow-ups.
- **The channel is opened only when asked, as today.** The board exists either way, since its
  rows live in the organization's storage, not in the channel's session.
- **The three checks read rows where they now live.** Their claims, legs and controls do not
  change.
- **Hire is handed the tree's board ids**, so a kind that stops declaring the board warns.
- **The manager uses a channel's board id as is.** Its grammar widens by one thing: a single dot
  may join the parts it accepts today (letters and digits, joined by `-` or `_`). Nothing is
  translated, so every id accepted today derives exactly what it does now (the old set sits inside
  the new one). The manager already folds case, so two ids that differ only in case (`Foo` and
  `foo`) share a folder and branch today and still do; BR-14 keeps that. Collision-freedom is
  claimed for ids that differ other than in case, which covers every dotted id a channel mints
  beside every id accepted today.
- **A channel board may not be named `lock`, in any case.** It would mint `eng.feature.lock`, and
  git refuses a branch part ending in `.lock`. The workforce package's board-name rule reserves it,
  so a tree declaring one fails at load, in the rule's own words, and every board a channel can
  hold is one the manager can run. Chosen over encoding the name, which is a mapping with its own
  collisions to prove. No board in this repository is named `lock`; an app outside it with one
  gets a load error naming the rule, in a `patch` changeset for `@flow-state-dev/workforce`.
- **The manager still checks its board's id when it is built, not when a row is claimed.** Its
  wider grammar also takes dotted ids no channel minted, so it refuses a `.lock` ending itself.
  Refused at build, the tree fails before anything is hired. Refused at the row, the row is
  claimed, the checkout fails, and the retries are spent on a name no retry fixes.

## Considered and dropped

| Alternative | Why not |
|---|---|
| A copy of each row on the channel, kept in step by the lab | Two writes that disagree exactly when a run fails or retries. The rejected half of D1 |
| Leave the board in the kinds; shift-manager reads it there | shift-manager reads a workstream through its channel and names nothing from a tree. The rejected (b) of D1 |
| A new manager option that lets the caller name the checkout partition | Hands every caller an identity to invent, and two boards given the same one would share checkouts, the collision the manager's derivation exists to prevent |
| Translate the dots (to `-`, `_`, or an encoding) | Collides with ids that are legal today: `eng.feature.work` becomes `eng-feature-work`, which a board may already be called, and the case fold widens the set. Using the id as is has no mapping to prove |
| Leave `lock` legal on a channel and refuse it only at the manager | Then one valid channel board can never back a coding run, and D1's promise has an exception found only when a manager is built. Reserving one name at the channel costs one line |
| Encode a `.lock` ending (or every id) into a safe spelling | A mapping, with its own collisions to prove against ids legal today; reserving the one name has none |
| Rebuild onto the channel's `fileTask` and a plain drain, as FIX-1385's own check does | Loses the issue-and-phase row id the manager requires, and changes what the three checks prove |
| Walk shift-manager's board journey on another tree | Rejected by [FIX-1663 D1](../FIX-1663/DECISIONS.md#d1): the epic pins the DevTeam tree |

## Settled

- **The manager refuses a board a channel holds** — **CONFIRMED** by running its grammar. The
  manager checks the board's id against `DERIVED_IDENTITY` before deriving a checkout or branch
  (`packages/harness-manager/src/workspace.ts`, `locationSegments`); that pattern allows letters,
  digits, `-` and `_` only (`packages/harness-manager/src/identity.ts`). Run against both ids:
  today's `devforce-tasks--t0--feature` → accepted; the channel's `eng.feature.work` → refused.
  Command:
  `node -e 'const R=/^[A-Za-z0-9]+(?:[_-]+[A-Za-z0-9]+)*$/; for (const s of ["eng.feature.work","devforce-tasks--t0--feature"]) console.log(s, R.test(s))'`
  → `false`, `true`.

## How it got here

- **Draft** — framed as the channel holding the one ledger the EM files onto and the coder's
  run settles; the manager's refusal of dotted board names found in research and fixed at its
  source rather than mirrored around; one PR.
- **Round 1** — the manager uses a channel's id as is and checks it when built.
- **Codex review** — who owns a run on a shared board became D3 (a second member's retry would
  have forked the run); `lock` reserved as a channel board name; collision-freedom scoped past the
  manager's existing case fold.

**Open: none.**
