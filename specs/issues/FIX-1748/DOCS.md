# FIX-1748 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

A rename changes words, not what any page teaches. So this draft carries new prose only where a reader needs more than the swap: the mailbox page's opening, what happened to old trees and stores, and Inbox beside mailbox. Everywhere else the operation is the swap, with the anchors and copy it moves listed. Owner: this issue. P1 publishes the README and UI copy; P2 publishes the site.

## MOVE · `apps/docs/docs/workforce/channels.md` → `mailboxes.md` · frontmatter and opening

```md
---
title: Mailboxes
sidebar_position: 4
sidebar_label: Mailboxes
description: "A mailbox is one addressable conversation that several agents and people can post into, with one durable transcript. Posting hands nobody the work; a board the mailbox holds is where work someone takes and finishes lives."
---

# Mailboxes

Several agents working one topic. Each of them reads what the others said. Posting hands
nobody the work, and the conversation needs somewhere to live that outlasts whoever spoke
last. When the talk does produce work somebody has to take and finish, the mailbox can
hold a board for it.

That is a mailbox: one address, one conversation, any number of writers. It is not a room
you join and leave, and it is not a list of everything waiting for you. The framework ships
the flow that runs mailboxes, and each mailbox you open is a named session on it.
```

## UPDATE · `mailboxes.md` · "What a mailbox is", after its first paragraph

```md
A mailbox is a session, not a new type beside flows and collections. The framework ships
the kind, which is called `mailbox`, and every mailbox you open is another named session on
that one registered instance.

If you use Shift Manager, two of its words sit next to this one. A **workstream** is a
team's mailbox together with the boards it holds. **Inbox** is the list of questions waiting
on you across every mailbox you can see. Neither is a second kind of mailbox.
```

## UPDATE · `mailboxes.md` · new section before "What mailboxes do not do yet"

```md
## Upgrading from channels

Mailboxes used to be called channels, everywhere: the record file, the folder, the kind,
the items in a transcript and the exports. The rename did not keep the old names working.

- **Files.** Rename `teams/<team>/channels/<name>/CHANNEL.md` to
  `teams/<team>/mailboxes/<name>/MAILBOX.md`, and `workforce/flows/channels/` to
  `workforce/flows/mailboxes/`. A tree that still has the old names reports an error for
  each one, and `fsdev gen` refuses to run. Neither is skipped.
- **Code.** Every `channel` export has a `mailbox` name: `channelFlow` is `mailboxFlow`,
  `openChannels` is `openMailboxes`, `ChannelManifest` is `MailboxManifest`. A transcript
  line is a `mailbox-post` item.
- **Stored data.** A store written before the rename does not open. The boot stops and
  says so, because the store holds sessions on a kind that no longer exists. Start from an
  empty store. Old conversations, and the inventory rows that listed old channels, are not
  carried over.
```

## UPDATE · the swap, page by page (P2)

Replace the pipe's name in prose, code samples, headings and alt text. Leave every other meaning of the word, listed in the guard.

| Destination | Operation and the anchors it moves |
|---|---|
| `workforce/mailboxes.md` | Swap throughout. `#routing-a-channel` → `#routing-a-mailbox`; `#holding-a-board` and `#where-posting-from-another-flow-works-and-where-it-doesnt` unchanged |
| `workforce/overview.md`, `inventory.md`, `projects.md`, `workers-on-disk.md`, `built-in-worker.md`, `durable-hire.md`, `code-on-disk.md`, `chief-of-staff.md`, `ui.md` | Swap; links to `channels.md#…` re-pointed |
| Plates in `workforce/`: `channels-parts.svg` (→ `mailbox-parts.svg`), `inventory-rows.svg`, `workforce-overview.svg`, `project-overview.svg`, `project-room-membership.svg`, `built-in-worker-memory.svg`, and any FIX-1746 plate merged by then | Text and `aria-label` only; layout unchanged |
| `devtool/overview.md`, `client/react.md`, `orchestration/{agents,discovery,harness-manager,task-board,overview}.md`, `resources/client-access.md` | Swap where the pipe is meant; `flowKind: "mailbox"` in the React sample |
| `guides/keeping-a-flow-running.md` | Swap; "A channel or a board" becomes "A mailbox or a board" |
| `docs/architecture/*`, `docs/atlas/*` | Swap where the pipe is meant |
| `apps/docs/sidebars.ts` | `workforce/channels` → `workforce/mailboxes` |
| `apps/docs/docusaurus.config.ts` | Add redirect `{ from: "/docs/workforce/channels", to: "/docs/workforce/mailboxes" }` |

## UPDATE · package READMEs (P1)

`packages/workforce/README.md`: the "Channels" heading and its sections become "Mailboxes", with every sample in mailbox names, and the upgrade note above in three lines. `harness-manager`'s "Running a channel's board" becomes "Running a mailbox's board". `react`'s navigator example labels its section **Mailboxes**, `kinds: ["mailbox"]`. `fsdev`'s `gen` section names `flows/mailboxes/` and `mailboxKinds`.

## UPDATE · the copy people and agents read (P1)

For the owner's copy look before merge. Every other string is the same sentence with the word swapped.

| Where | Today | After |
|---|---|---|
| Shift Manager · posting | "Posting… the line appears once the channel keeps it." | "Posting… the line appears once the mailbox keeps it." |
| Shift Manager · a failed post | "The channel did not confirm the line in time; it may not have been kept." | "The mailbox did not confirm the line in time; it may not have been kept." |
| Shift Manager · charter empty state | "This workstream's channel declares no charter." | "This workstream's mailbox declares no charter." |
| Shift Manager · empty inventory | "…it registers no seats and no channels." | "…it registers no seats and no mailboxes." |
| Kitchen-sink · composer | label "Post to this channel", placeholder "Write a line for this channel…" | "Post to this mailbox", "Write a line for this mailbox…" |
| Kitchen-sink · rail | section **Channels**, "Channels, seats and conversations" | **Mailboxes**, "Mailboxes, seats and conversations" |
| DevTool · Inventory | "Registered channels", column **Channel** | "Registered mailboxes", column **Mailbox** |
| A seat's tool | "Post a line to a channel you are a member of, under your own name." | "Post a line to a mailbox you are a member of, under your own name." |
| Discovery tool | "…the seats you can hand work to, the channels they share…" | "…the seats you can hand work to, the mailboxes they share…" |

## Changeset (P1)

```md
---
"@flow-state-dev/workforce": minor
"@flow-state-dev/contracts": minor
"@flow-state-dev/core": minor
"@flow-state-dev/fsdev": minor
"@flow-state-dev/devtool": patch
---

Channels are now mailboxes, everywhere: `MAILBOX.md` records under `teams/<team>/mailboxes/`,
kinds under `workforce/flows/mailboxes/`, the `mailbox` kind, `mailbox-post` items,
`inventory/mailboxes/` rows, the `post-to-mailbox` tool, the `mailboxes` discovery domain,
and every export (`mailboxFlow`, `openMailboxes`, `MailboxManifest`). The old names are
not read: an old file is reported by name, and a store written before this release does
not open. Start from an empty store (FIX-1748).
```
