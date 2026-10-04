# FIX-1779 · Decisions

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

Two decisions are the sign-off surface. Everything else here is context for them.

## The tree

```mermaid
flowchart TD
  I["FIX-1779"] --> D1["D1 · a run-time mailbox lives in org data<br/>its session and its inventory row"]
  D1 -.->|"rejected"| X1["write a MAILBOX.md<br/>a deploy per mailbox, and no file system in a hosted app"]
  I --> D2["D2 · add and remove workers on any mailbox<br/>the file is the starting list"]
  D2 -.->|"rejected"| X2["only on mailboxes set up at run time<br/>a hire can't join the team's own mailbox"]
```

Solid edges are what you're signing. Dashed edges lost, and the label says why.

<a name="d1"></a>
## D1 · A mailbox the coordinator sets up lives in the org's data: its session and its inventory row. Nothing is written to a file

| | |
|---|---|
| **Instead of** | Writing a `MAILBOX.md` into the team's folder and opening it the way a file mailbox opens |
| **Because** | A coordinator works while the app runs, often on a host with no writable source tree, and a file it wrote is a deploy nobody reviewed. The org's data already holds everything a mailbox is: the session holds its members and charter, and the inventory row is how it is found. A project already lives this way ([FIX-1650 D3](../../epics/FIX-1650/DECISIONS.md#d3)). Adding the task list and who works it to the session keeps one record per mailbox, not a second registry |
| **Locks in** | Mailboxes the coordinator set up are not in the repository. A code review never sees them, and a fresh environment starts without them. A team that wants one permanently writes the file, as today |

![D1, where a mailbox set up at run time lives. Chosen: the org's data, its session and inventory row. Instead of: a written MAILBOX.md. It comes down to a hosted app with no writable source tree: org data works there, a file can't be written. The price is that the repository doesn't show it. Restart is a tie: both survive. Locks in: these mailboxes are not in code review. Flips if: run-time mailboxes must be reviewed like code before they exist.](figures/d1-where-it-lives.svg)

It comes down to a hosted app: the coordinator can't write a file there, and org data is already where projects live.

**What would change my mind:** a rule that every mailbox must pass code review before it
exists. Then the coordinator should propose a file in a pull request, and this issue becomes
a docs change.

<a name="d2"></a>
## D2 · The coordinator can add and remove workers on any mailbox, including one from a file. The file is the starting list

| | |
|---|---|
| **Instead of** | Changing membership only on mailboxes set up at run time, leaving file mailboxes exactly as their files say ([FIX-1415](../FIX-1415/DECISIONS.md#recommended-still-open)'s lean) |
| **Because** | Jake's job for the coordinator is to get work flowing to the right places. The most common move is putting a fresh hire on the team mailbox that already exists, and that is a file mailbox. The file is already only the starting list: an edit to `members:` never reaches a mailbox that is open, so the session has been the record since its first open |
| **Locks in** | A `MAILBOX.md` stops being the whole truth about who is on a mailbox. `discover` and the inventory show the live list. A person who edits the file's members still has to open a fresh mailbox for that edit to apply, as today |

![D2, which mailboxes the coordinator can change. Chosen: any mailbox. Instead of: only ones it set up. It comes down to a hire who must join the team's existing mailbox: chosen puts it there, the other forces a near-duplicate mailbox. The price is that a MAILBOX.md is no longer the whole member list. Undeletable file mailboxes is a tie. Locks in: the file is a starting list. Flips if: teams need a file's members locked.](figures/d2-which-mailboxes.svg)

It comes down to a hire who must join `eng.feature`: the narrow rule forces a second, near-duplicate mailbox.

**What would change my mind:** a team that needs a file mailbox's members fixed for audit. A
per-file `lockMembers: true` would answer it without changing the default.

## Decided, not asked

- **The tools are named grants.** `setUpMailbox`, `subscribeWorkers`, `unsubscribeWorkers`, `fileTask` are catalog tools from one capability a host installs on a kind; a worker reaches them only by naming them in `tools:`, the way `hire` works. Any coordinator in any app, not a DevTeam special case.
- **Opening goes through the host.** The coordinator's turn runs as the person, and a mailbox belongs to the app. The host hands the capability an opener, as it hands `hire` a `register`. No core or engine change.
- **The wake asks the host who can be reached, on every post.** Member names still come from the mailbox; where to deliver comes from the host's live worker list, never from stored data (BP-031). This also fixes hires reloaded at restart, which today are never woken.
- **A run-time mailbox has exactly one task list, `tasks`, and records which workers work it.** Subscribing does not make a member a worker of the list: a member can be a reviewer or a person. `setUpMailbox` defaults the list's workers to its initial members.
- **A worker name must exist in the org** (declared or hired) or the call is refused by name. This closes the "no member name resolution" gap for these tools only.
- **Ids follow the file convention**, `<team>.<name>`, and the team must exist. An id already taken, by a file or by the coordinator, is refused.
- **Setting up does not attach to a project.** `setWorkstreams` already does that, and accepts the mailbox once its inventory row exists.
- **The org comes from the caller's identity**, never from tool input.

## Considered and dropped

| Alternative | Why not |
|---|---|
| A mailbox-admin type, or a new org collection of mailboxes | A second registry beside the inventory. The session and its row already are the record |
| Delete, rename, and a client join or leave | Not asked. Delete is a retirement rule with its own open questions (what happens to the list's open tasks) |
| Routing and `boardActions` on a run-time mailbox | Both are built into the mailbox kind at start. A coordinator can post and file without them |
| Restart the app after a change so the boot lists pick it up | Turns every hire into downtime, and the reloaded hires aren't woken even then |
| A board per mailbox registered at run time | Task lists are resources fixed when the kind is built. One declared collection for all run-time lists, read by prefix, needs no re-registration |
| Hand the work over by posting it | The rule is to file it on the list, which is what Jake asked for |

## Settled

- **A worker registered after start can be woken by a post, with no core or engine change** — **CONFIRMED**: the router's existing `validateRoute` hook accepts a wake built on first use, and a member written into the session after open is woken on the next post. The same run with today's start-up list did not wake it. ([POC](poc/live-membership/README.md))

## How it got here

- **Draft** — framed as two start-up lists (mailboxes with their task lists, and workers a post can wake) that must become run-time and durable. The mailbox's own session carries members, its task list and who works it; the wake asks the host per post. Two stacked PRs.
- **Scope widened before publishing** — Jake (2026-10-04) asked for the coordinator's whole job, not one flow. D2 moved from run-time mailboxes only to any mailbox, and removing a worker came in.

**Open: none.**
