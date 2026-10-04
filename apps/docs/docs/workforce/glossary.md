---
title: Glossary
sidebar_label: Glossary
description: Vocabulary review — what each workforce word means in this repo today, and which ones are overloaded, dead, or only code identifiers.
---

# Glossary

This page is for a vocabulary review, not a how-to. How-tos stay on the other Workforce pages. These words overlap. This page records what each one means in this repo today, so a review can kill the bloated ones. Nothing here renames an identifier or changes behavior.

Each entry is the word, what it means now, and a flag when the word is doing two jobs, already dropped, dead, or only a code name. How-to pages and package READMEs still say **seat** and **channel**. Treat that as drift, not a second definition.

## Locked product calls (2026-10-03)

State these. Do not relitigate them in this review.

- **Seat** and **role** are dropped as product nouns. One worker file declared on a team is one worker in that org. A session is another piece of work for that same worker, not a second hire. Do not split "template vs instance."
- The code still says `seat` (`seatPost`, `seatAuthored`, `wakeMemberSeats`, seat pane). Those stay as code identifiers in this change.
- `seatAuthored` means the line came through that worker's own `seatPost` or its answer, and other members are not woken. A claimed `author` field does not set it.
- A **member** is a name on the mailbox member list. The only thing that hears a post is a hired worker whose kind declares `onChannelPost`.
- Product and wire: **channel → mailbox** (full rename, including `CHANNEL.md`, still in flight). **Inbox** stays the ask listing over many mailboxes, never a synonym for one mailbox.
- A **room** is the shared place for one project. A **mailbox** is one worker's private pipe.
- Shift Manager chrome says **Shift Coordinator**. The worker id and folder stay `chief-of-staff`.
- **Agent** is the persistent identity. Do not add Agent, Team, or Channel as Layer 1 substrate. Those are Workforce opinions on Layer 1 primitives.

## Flags

| Flag | Meaning |
|------|---------|
| **keep** | Product noun. Use this. |
| **overloaded** | Two or more live meanings. Kill or split in the review. |
| **dropped** | No longer a product noun. Docs still say it. |
| **code-only** | Identifier or UI handle. Do not teach it as a product word. |
| **dead** | Refused or unused as a workforce noun. |
| **mid-rename** | Product name has moved; files and code have not. |
| **confusing** | Easy to mix with a neighbor. |
| **redundant** | A second word for something already named. |

## People and work

### Worker — keep

One `WORKER.md` on a team is one worker in that org. Hiring that file is how the worker becomes addressable. A later session is more work for the same worker, not another hire.

**Overload:** Orchestration also calls a board block, tool, or skill agent a "worker." A task's `assignee` names that board worker, never a hired workforce worker.

### Session — keep

Another piece of work for an already-hired worker. You open it against that worker the way you open one against any flow. It is not a second hire, and it is not a second worker.

**Overload:** Today's channel is also "a session on the channel kind." That is the Layer 1 primitive underneath the mailbox, not a second product noun.

### Agent — overloaded

Product: the persistent identity of a hired worker. Workforce opinion on Layer 1, not a Layer 1 type.

Also live today:

- The built-in flow kind named `agent` (what a `WORKER.md` with no `flow:` runs on).
- An orchestration skill agent: a persona plus tools that claims board tasks.

Three meanings. The kind name and the board-agent sense are the ones to kill or qualify.

### Hire — keep

Turn a worker record into an addressable flow copy (`hireWorkforce`). A runtime hire writes a roster row so the worker survives a restart. Firing removes a runtime hire. A session is not a hire.

### Fire — keep

Remove a runtime-hired worker. File-declared workers leave when someone deletes their folder. A fire can wait for a person's approval.

### Member — overloaded

On a mailbox: a name on that mailbox's member list. Listing someone does not make them hear a post. The only listener is a hired worker whose kind declares `onChannelPost`.

On a project: a person (`userId`) who may read and post in the project's room.

Two lists, two kinds of thing. Easy to treat as one.

### Role — dropped

Dropped as a product noun (2026-10-03). Not a workforce setting. A `WORKER.md` that declares `persona:` is refused; `role` is not a hire field. Prompt templates and model messages still say `role`. That is chat shape, not a person at the org.

### Persona — dead

A `WORKER.md` that declares `persona:` is refused. Orchestration still uses persona for a skill agent's prompt. Not a workforce noun.

### Desk — confusing

Informal name for a support team, plus leftover ids (`support.desk`, `desk-clerk`). Not a product type. Kill as a taught word.

## Places

### Mailbox — keep, mid-rename

Product name for one worker's private pipe. The full rename from channel, including `CHANNEL.md`, is still in flight. Code, folders, and the channels page still say channel.

Today's shipped channel is a named session with members, a charter, and a shared transcript. The product call is the private pipe, not that shared room. Mark the gap; do not invent a third noun to hold it.

### Channel — mid-rename, dropped as product

Today's docs and code name for the thing becoming mailbox. Folders still live at `teams/<team>/channels/<name>/CHANNEL.md`. Do not teach Channel as Layer 1. After the rename, this word should die as a product noun.

### Inbox — keep

The ask listing over many mailboxes. Approvals and questions waiting on you. Never a synonym for one mailbox.

### Room — keep

The shared place for one project. Members of that project read and post there. It is not a mailbox. Anyone in the org can see the project exists; only members read the room.

### Workstream — redundant, confusing

Today: a channel plus the boards it holds, grouped by a project. After mailbox/room, it is a second word for "mailbox that holds a board" or "work under a project." Candidate to kill.

### Project — keep

An organization row: title, brief, owner, members, the workstreams it groups. Not a file. Each project has one room. Visible to the org; the room is not.

## Organization

### Org — keep

The tenant every request runs in. Organization-level workers live under `workforce/org/workers/` and hire by folder name alone (`chief-of-staff`). Org-scoped data (projects, inventory, hired roster) is per organization.

**Confusing:** `org` the folder vs organization the tenant. Same word, two spellings (`org` / `organization`).

### Team — keep

A folder of workers, optional `TEAM.md`, under `workforce/teams/<name>/`. Workforce opinion on Layer 1, not a Layer 1 type. Shift Manager's TEAMS list is this folder grouping.

### Staff — confusing

Shift Manager sidebar row for organization-level workers (the chief of staff and anyone else under `org/workers/`). Not a type. Easy to read as a third grouping beside team and org.

### Lab — keep, confusing

A served workforce from one `fsdev.config`. Shift Manager opens a Lab. Today's chrome still says seats and channels; that is the same drift as the rest of the site. Not an org, not a team, not a project.

### Roster — overloaded

Two live uses: the set of worker records you hire, and the stored collection of runtime hires (`workforce/roster/*`). "Who did we declare?" and "who is hired right now?" are different questions.

### Inventory — confusing

Org-scoped rows that a seat or channel was registered. A row is not "open" or "working now." Easy to mix with roster.

### Board worker / assignee — confusing

Orchestration: the block, tool, or skill agent that claims a task. A task's `assignee` never names a hired workforce worker. "Worker" here is the overload under [Worker](#worker--keep).

## Chrome and ids

### Shift Coordinator — keep

Shift Manager's opening chrome (`/` / `/cos`). Summary of asks and runs, plus the conversation with the Lab's chief-of-staff worker. The empty state says "This Lab declares no shift coordinator."

### Chief of staff — keep (id), confusing (name)

The worker id and folder: `org/workers/chief-of-staff/`. Chrome says Shift Coordinator. Two names for one worker. The id does not change.

### Ask — keep

A question or approval waiting on a person. Inbox lists asks across mailboxes. Not a mailbox, not a session.

## Code identifiers that still say seat

These stay in this change. Do not teach them as product nouns.

### seat — dropped, code-only

Old product word for a hired worker ("a hired worker is a seat"). Dropped 2026-10-03. Still in identifiers, the seat pane, `SeatDetail`, `seat-hire`, `seatId`, and most workforce pages.

### seatPost — code-only

Channel action that posts a line as that worker's own. Sets `seatAuthored`. A client or dispatched `post` is a different action and does not.

### seatAuthored — code-only

Flag on a transcript line: it arrived through that worker's own `seatPost` or its answer. Other members are not woken. A claimed `author` field does not set it.

### wakeMemberSeats — code-only

Notify block that wakes each mailbox member whose hired worker declares `onChannelPost`, once per post. Skips the wake when `seatAuthored` is set. The name still says seat.

### onChannelPost — code-only

Internal entry a kind declares to hear a mailbox post. Built-in `agent` declares it. A member list name without this entry hears nothing.

### seat pane / `SeatDetail` — code-only

UI for one hired worker's kind and instructions. Kitchen-sink draws it in the rail. The component is `SeatDetail`.

## Related pages

- [Workforce](./overview) — hiring a roster of workers.
- [Channels](./channels) — today's channel pages; product name is mailbox.
- [Projects](./projects) — the project row and its room.
- [The chief of staff](./chief-of-staff) — the `chief-of-staff` worker; chrome says Shift Coordinator.
- [Orchestration](../orchestration/overview) — board workers and assignees, not hired workers.
