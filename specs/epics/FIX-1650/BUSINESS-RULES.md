# FIX-1650 · Rules every issue in the set obeys

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The constraints every child spec and implementation satisfies, and where a cross-spec review
checks them. Each has one owner. ER-1 to ER-9, ER-19, ER-20, ER-25 and ER-26 are in
[the ownership matrix](DECISIONS.md#who-owns-what); the fences and process rules sit outside it.

## What a team gets, and what it doesn't

| # | Rule | Owner | Checked at |
|---|---|---|---|
| ER-1 | A project is one row in the org `projects` collection, the only home of its data, created by CoS with `create()` and listed by anyone in the Lab's org. FIX-1718 builds that whole path: the `createProject` action and its tool wired onto the CoS seat FIX-1719 boots. The row lists `members`, written only by trusted code (CoS at create, later a member's invite). Narrative: [Q1](DECISIONS.md#q1). *Implementer note:* `members` is a persisted shape (BP-023, BP-030) | FIX-1718 decides and builds CoS's create path | The closure's leg a |
| ER-25 | Each person's talk session is minted from the project template: by default the org-level one declared beside the collection in `org/resources/projects.ts`, or, for a team's projects, a team `CHANNEL.md` that declares `mintFor: projects`. It is minted the creator's on create and a member's on `join`, and linked both ways by `bind`: `resourceId` in session state, `sessions: [{ sessionId, userId }]` on the row. A create outside a flow turn mints none; its members `join`. Join and its append follow [ER-27](#what-no-child-may-do); a failed bind is recovered by [ER-28](#what-no-child-may-do). *Implementer note:* `resourceId` and `sessions` are persisted shapes (BP-023, BP-030) | FIX-1718 decides | The closure's leg a |
| ER-26 | Project talk lives only in `room-lines` rows on the org side, created and never edited, ordered by a per-project sequence on its own row; a line's `userId` is the poster's engine-recorded session owner. Only members read or post ([pending Jake](DECISIONS.md#pending-4)). No `channel-post` item mirrors project talk. If Jake answers card 1 "per person first", this rule drops out and FIX-1728's per-person talk is the baseline ([Q1](DECISIONS.md#pending-1)). *Implementer note:* read by key prefix and cursor (`prefetchMode: "lazy"`); readers skip a seq gap | FIX-1718 decides | The closure's leg a |
| ER-2 | A workstream is a declared channel with its kind and the boards it holds. There is no Workstream type | FIX-1718 decides · FIX-1719, FIX-1720 consume | FIX-1719's spec review |
| ER-4 | CoS hires without asking ([Q2](DECISIONS.md#q2), Jake, 2026-10-01), only a kind the Lab registers, never a declared seat's id. No other seat hires; a seat that wants a hire messages CoS. Fires: [ER-20](#what-a-team-gets-and-what-it-doesnt). A repair's re-hire is a repair, so it asks ([ER-5](#what-a-team-gets-and-what-it-doesnt)) | FIX-1719 decides · FIX-1621 consumes for retire and re-hire | The closure's leg b and its control |
| ER-5 | An orphan is a stored seat whose kind is not in the map the Lab boots with. It is named with the reason and repaired only on approval: retired, or re-hired onto a registered kind. Approval on a retire holds through the seat-hire capability's `askBefore` setting, since retire is fire ([ER-19](#what-a-team-gets-and-what-it-doesnt)); DevTeam passes `["fire"]` | FIX-1621 decides · FIX-1719 consumes | The closure's leg c |
| ER-6 | CoS is one document under `org/workers/` on the shipped `agent` kind and seat-hire capability, which a Lab opts into; a Lab that doesn't add it has no CoS. There is no Ops seat. FIX-1719 makes a declared org seat hireable in Layer 2: nothing in Layer 1, no new noun, no team named `org`, no second hire store ([Q2](DECISIONS.md#q2)) | FIX-1719 decides · FIX-1718 consumes | FIX-1719's spec review |
| ER-7 | Every hire, fire and repair lands in the organization the request's principal names, in that owner's cell. Single user; no org id is read from a body. A seat declared under `org/workers/` is not an org-owned hire cell: hiring it lands in the principal's cell too | FIX-1621 builds · FIX-1719 consumes | FIX-1621's tests · the closure |
| ER-19 | Fire and retire are one mutation path, and it removes the seat's inventory row. A row written before the change still reads, and a row for a seat no longer hired is not listed under TEAMS (BP-030) | FIX-1621 decides · FIX-1719 consumes | FIX-1621's tests · the closure's leg b |
| ER-20 | When `fire` is in the Lab's `askBefore` ([FIX-1719 D2](../../issues/FIX-1719/DECISIONS.md#d2)), CoS raises each fire as a `human_approval` suspension (`ctx.suspend`), the ask Inbox already renders and resumes; the fire is applied only on resume with Approve, Deny changes nothing, and a restart in between leaves it asked, not half-made. A hire runs the same path without the ask ([Q2](DECISIONS.md#q2)); asking before a hire comes back as a policy switch, not new work, and FIX-1719 adds no setting beyond what that needs. FIX-1719 puts the gate on the seat-hire capability's tools (`askBefore`). Approval on fire and retire holds through that setting; DevTeam passes `["fire"]` | FIX-1719 decides · FIX-1621 consumes | The closure's leg b and its control |

## What no child may do

| # | Rule | Because |
|---|---|---|
| ER-3 | Retire, invite to or rename a channel at runtime, or open one other than by minting a talk session from a template on create or on join | [D3](DECISIONS.md#d3), amended with Q1. Owner: FIX-1718, which builds the mint and nothing beyond it, and CoS's create path; FIX-1719 consumes: its CoS seat creates rows through that path and opens nothing. Adding a member to a project's row is a row edit, not a channel invite |
| ER-8 | Remove a Shift Manager gap entry it does not fill, or change the shell's frame | FIX-1649 owns the frame; the issue that fills a surface replaces its entry and nothing else. Owner: FIX-1718 for the project entries |
| ER-10 | Add `workforce/projects/`, `workforce/agents/`, a `CHANNELS.md` convention, or an L1 Agent, Team, Channel, Project or Workstream | [D2](DECISIONS.md#d2) and the Architect's invent-kills |
| ER-11 | Add a CoS or admin-seat type, a second hire store, or a parallel ops taxonomy | Composed from existing seat and kind registers |
| ER-12 | Map a cut kind onto another kind, or register a missing kind so an orphan boots | FIX-1621's fences: no auto-migrate, kinds enter only through the boot map |
| ER-13 | Call a seat or an assignee a "worker" in a new product noun, or productize Kind | The Architect's vocabulary fence |
| ER-21 | Keep a project's data or its conversation in session state, make a session the project, share an engine session between users, or let one person read or post into another's talk session, including by an L1 session-access change. The shared room lives on the org side, beside the project row | Jake's fence on [Q1](DECISIONS.md#q1), amended with the FIX-1729 spike: people share the room, never a session. A shared session (option A) is rejected: size L, all on the auth surface. Owner: FIX-1718 |
| ER-22 | Register a minted talk session in `inventory/channels/*`, or have the PROJECTS list read the Lab's checkout rather than the `projects` rows | Every person's talk session would flood the Lab's channel list, the hole FIX-1415 named; the Architect's pass on #2629. Owner: FIX-1718 |
| ER-23 | Grant access to a project or its room from `resourceId` in session state, or from any other field the caller supplies. Access is the engine-recorded session owner checked against the row's `members` | Session state is caller-writable at create: in the FIX-1729 POC (N1) a non-member's session carrying a project's `resourceId` landed, and only the row check refused her (BP-031). Owner: FIX-1718 |
| ER-24 | Lose a post when several people post at once | The engine's three compare-and-swap retries lost one post in ten under a two-person burst in the FIX-1729 POC. The sequence counter sits on its own row and the room retries its allocation itself; with that, ten of ten landed. Owner: FIX-1718 |
| ER-27 | Lose a join, or mint a second talk session for the same person and project. A talk session is keyed by `(projectId, userId)`, never by the caller's session: a join from a second window or session adopts the existing talk session, and no duplicate enters `sessions`. Otherwise `join` mints one and appends it with the same retry as the room's sequence counter ([ER-24](#what-no-child-may-do)) | Concurrent appends to the project row's `sessions` are the same hot-row race ER-24 settles for posts, untested in either spike. A keyed dispatch derives the child id from its parent session, so two windows would mint two sessions unless the key is the project and the person (Codex's review). An idempotent, retried join is the smaller fix than moving `sessions` to rows of their own; FIX-1718 carries it as its BR-16a. Owner: FIX-1718 |
| ER-28 | Leave a project row permanently unbound because its create-time reaction or `bind` failed. The row records its bind state, and an idempotent re-bind completes it: on read, on `join`, or when a CoS retry of the create finds the existing row | A collection reaction runs after the row commits, so the row persists while the create call rejects, and retrying `create()` meets an existing row and never refires `created` (Codex's review). FIX-1718 carries the same rule in #2625. Owner: FIX-1718 |

## How the set is run

| # | Rule | Because |
|---|---|---|
| ER-14 | FIX-1718's spec starts only after Jake's answer to Q1 is recorded, and FIX-1719's only after Q2's (both answered 2026-10-01, each recorded by amendment). FIX-1718's spec ([#2625](https://github.com/fixpoint-labs/flow-state-dev/pull/2625)) is rewritten on Q1 as recorded here and is unblocked once this amendment merges. FIX-1621 and the closure's QA plan start at the gate | [D1](DECISIONS.md#d1). An answer is recorded in *Decided in review* by an amendment before the held spec starts |
| ER-15 | An answer that needs a folder or an L1 type comes back to this epic as an escalation | [D2](DECISIONS.md#d2) |
| ER-16 | A cross-cutting question is raised to the epic coordinator, not decided in one child | The retained decisions are canonical; after merge, a change is a follow-up PR |
| ER-17 | Implementation starts when Jake schedules it, not when this spec merges | Not Cycle 1; [PLAN.md](PLAN.md#timing) |

## The closure

| # | The epic is done when | Proved by |
|---|---|---|
| ER-9 | [The goal](SPEC.md#the-goal-and-how-well-know-its-met) is met: legs a, b and c pass, and leg b fails under Deny on the fire, on one `main` commit with every bug an earlier run found fixed as a child of this epic | FIX-1720's goal check, real model, in a browser |
| ER-18 | Every row in [DOCS.md's ownership table](DOCS.md#ownership) is published | Each publisher's own PR |
