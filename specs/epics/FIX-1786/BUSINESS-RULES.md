# FIX-1786 · Rules every issue in the set obeys

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The constraints every child spec and implementation satisfies, and the place a cross-spec
review checks. Each says who owns it and where it's checked. Under all of them sits the
concept's [security model](concept/CONCEPT.md#the-security-model): a behaviour none of its
seven rules explains is a bug in the model.

## What a team gets, and what it doesn't

| # | Rule | Owner | Checked at |
|---|---|---|---|
| ER-1 | A worker is a configuration plus an owner, stored as a user-scoped resource. Standard workers are a read-only collection projected from the installation's files; forking one hires a non-standard worker. A session's link to its worker is set by trusted code, never by a caller, in session state the public create can't seed ([D3](DECISIONS.md#d3)), and a forged link reads nothing. A worker's private state is keyed by the worker, not the flow, and today's per-seat cells move to it (BP-030) | FIX-1788 decides · FIX-1791, FIX-1795, FIX-1792 consume | FIX-1791's and FIX-1795's spec review · the closure |
| ER-2 | A flow runs workers only when the installation registers it as a worker flow that meets the contract: it composes `workerConfigSchema()`, has a door, and keeps a worker's state private. A flow can be standard-only | FIX-1789 decides · FIX-1788, FIX-1791 consume | FIX-1788's spec review · the closure |
| ER-3 | User-scoped data is kept per (user, org) for every flow. A record stored before reads in one org at most: an operator step moves it to the one org it can be attributed to, and stops with `migration-required` on one it can't. No per-org cell falls back to the cross-org cell, which is the read this rule closes (the owner-pinned cell's rule, [`state-and-scopes.md`](../../../docs/architecture/state-and-scopes.md#the-owner-pinned-cell)). How a record is attributed is FIX-1790's first spec question | FIX-1790 builds · FIX-1788, FIX-1793 consume | FIX-1790's tests · the closure's second-org step |
| ER-4 | A coordinator's delegates live in its session state and start from its configuration's defaults. Both paths that change them, the app and the coordinator's own tool, pass one check: a delegate is on the same user's roster. The public create can't seed them ([D3](DECISIONS.md#d3)) | FIX-1791 decides · FIX-1793, FIX-1794, FIX-1792 consume | FIX-1791's tests · the closure |
| ER-5 | An answer doesn't trigger routing again, except for a set number of rounds. One answer per delegate per post. Every routing decision is recorded | FIX-1791 builds | FIX-1791's tests · the closure |
| ER-6 | A coordinator is declared in a `WORKER.md`. A standard coordinator names only standard delegates. An old `MAILBOX.md` is refused at load, by name, with the conversion in the message | FIX-1792 decides · FIX-1796 consumes | FIX-1792's tests |
| ER-7 | A project is private or shared, one project type. A workstream is its own resource, read by whoever reads the project and written only by its owner. Project progress is computed, never stored | FIX-1793 decides · FIX-1794 consumes | FIX-1793's tests · the closure's leg b, whose private-project step runs if [Q2](DECISIONS.md#q2) holds |
| ER-8 | A user talks to a project through their own project coordinator session, one per user per project. Rooms are removed | FIX-1793 builds | The closure |
| ER-9 | Every session in a chain belongs to the owner of the work. A board drains as its owner, never as whoever triggers it. A board whose rows a worker on another flow settles is stored at the owner's user scope: a lineage stops at a flow | FIX-1794 decides · FIX-1793 consumes | FIX-1794's tests · the closure's leg b |
| ER-10 | Adding a library template copies it into the user's scope. The copy never changes under them; taking an update is their choice | FIX-1795 decides | FIX-1795's tests |
| ER-11 | Everything written to a shared resource names the user, and the worker when one wrote it | FIX-1789 decides · FIX-1793, FIX-1795 consume | FIX-1793's and FIX-1795's spec review |
| ER-12 | No retired term is left in a package export, a published page or the glossary. Channel-kind paths and the engine's dispatch "target" stay | FIX-1796 builds · every child consumes | The closure's gap sweep |

## What no child may do

| # | Rule | Because |
|---|---|---|
| ER-13 | Make org optional or loosen org identity | FIX-1442. Per-org user data composes with it |
| ER-14 | Accept a worker flow that doesn't compose `workerConfigSchema()`, or add free-form config, a second registry of workers or a parallel worker store. The installation's list of worker flows ([Q1](DECISIONS.md#q1)) registers flows, not workers, and isn't one | The FIX-1367 WorkerConfig lock |
| ER-15 | Add an agent-memory field or a parallel memory graph, or document a memory layer a flow doesn't keep | Memory layers reuse resource scopes (2026-09-07 lock); FIX-1364's honesty rule. Long-lived session memory is FIX-1775's |
| ER-16 | Rely on "owner writes, org reads" before FIX-1793 builds it | It doesn't exist; the 2026-09-23 security lock left it for later |
| ER-17 | Grant access from session state or any field a caller supplies: a worker link, a project, a delegate | Retains FIX-1650's ER-23. Access is the engine-recorded owner checked against the resource |
| ER-18 | Share a session between users, or let any coordinator hand work to another user's worker | Security rules 2, 3 and 6 |
| ER-19 | Special-case a tool name to refresh a view | FIX-1761: a finished turn names the collections it wrote, and the view reloads them |
| ER-20 | Remove flow instances or owner pins from the engine, or rename channel-kind paths | Deprecated now, removed later. Channels are out of scope |
| ER-21 | Build channels, user-to-user communication, transcript resources, or files as migrations | The PRD's out-of-scope list |
| ER-22 | Add a Layer 1 noun, or a Layer 1 change outside [D3](DECISIONS.md#d3)'s three | An escalation to this epic, not a child's call |

## How the set is run

| # | Rule | Because |
|---|---|---|
| ER-23 | No refactor child starts implementation before FIX-1787's merge-first rows land or close; #2759 lands first of them. FIX-1787 blocks each child in Linear | The refactor starts from a known base ([D1](DECISIONS.md#d1)) |
| ER-24 | A cross-cutting question goes to the epic coordinator, never decided in one child. After merge, a change is a follow-up PR from `main` | The retained decisions are canonical |
| ER-25 | Each child documents its own behaviour, in the new terms, in the same change. FIX-1796 publishes the glossary and removes what is left | Docs move with code (Jake, 2026-10-03; [D4](DECISIONS.md#d4)) |
| ER-26 | A stacked PR says DO NOT MERGE and retargets to `main` when its dependency lands. Agents never merge implementation PRs | The orchestration contract |
| ER-27 | A child that joins the set blocks FIX-1797 from the wake that first sees it | Otherwise the closure could pass before it lands |

## The closure

| # | The epic is done when | Proved by |
|---|---|---|
| ER-28 | [The goal](SPEC.md#the-goal-and-how-well-know-its-met) is met: legs a, b and c pass on one `main` commit, leg c fails under its control, and every bug an earlier run found is fixed as a child of this epic | FIX-1797's goal check, real model, two users |
| ER-29 | Every row in [DOCS.md's ownership table](DOCS.md#ownership) is published | Each publisher's own PR, followed as written by the closure |
| ER-30 | Before the end, the privacy spine is proved at its own merge. On the `main` commit FIX-1788 merges on, leg c's worker steps run in Shift Manager with two users: Bob opens Alice's session, reads her worker and links a session to it, each refused, and Alice in a second org sees none of her first org's workers or records. The control must fail. A failure is a bug child that blocks FIX-1791 and FIX-1795 from merging. ER-28's run still decides | FIX-1797's milestone run, from its QA plan |
