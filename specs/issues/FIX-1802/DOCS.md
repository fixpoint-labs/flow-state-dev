# FIX-1802 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Reader-facing prose this issue publishes in P3, reconciled against shipped names and refusal
wording first. FIX-1794's draft puts filing on the coordinators page and defers its "Splitting
work" section here; this issue moves filing to a page of its own, since any worker can file now,
and leaves the coordinators page a pointer. Voice: [`CLAUDE.md`](../../../CLAUDE.md) → "Writing
Style". Watch for: "task session" and "delegate" defined on first use, no issue numbers, no
em-dash as a connector.

## CREATE · `apps/docs/docs/workforce/filing-work.md`

Sidebar: `workforce/filing-work`, right after `workforce/coordinators` in `apps/docs/sidebars.ts`
(FIX-1791 adds that page after `workforce/built-in-worker`). Front matter `sidebar_label: Filing work`.

> # Filing work
>
> Some work is a question, and a post gets it answered. Some work has to be done: a change made,
> a report written, a run that takes an hour. For that, a worker **files a task**: a row on a
> board, handed to one of its **delegates**, the workers it is allowed to hand work to. The
> delegate works it in a new session of its own, a **task session**, and the worker that filed
> it hears how it ended.
>
> Any worker can file, if its file says so. Most shouldn't, so none do by default.
>
> ## Giving a worker the filing tools
>
> ```md title="workforce/teams/eng/workers/em/WORKER.md"
> ---
> description: Leads the feature. Files the work, never does it.
> filing: true
> delegates: [eng.coder, eng.reviewer]
> ---
> ```
>
> `filing: true` gives the worker four tools: `fileTask`, `listTasks`, `reassignTask` and
> `cancelTask`. Your app can send the same four as actions on any of that worker's sessions. A
> worker without the line has none of them, and the app's `fileTask` on its session is refused.
> Coordinators are no exception: a coordinator files only if its file says so.
>
> `delegates:` is who it may file for, the same list a [coordinator](./coordinators.md) hands posts
> to. Each session starts from it, and you change one session's list with `addDelegate` and
> `removeDelegate`. A delegate has to be on the same user's roster. Naming `delegates:` without
> `filing: true` on a worker that isn't a coordinator is refused when the app loads.
>
> The built-in worker and the coordinator flow carry the tools. A worker on your own flow needs
> the flow to carry them too:
>
> ```ts
> import { createTaskFilingCapability, workerConfigSchema } from "@flow-state-dev/workforce"
>
> const filing = createTaskFilingCapability()
>
> export const em = defineFlow({
>   kind: "em",
>   uses: [filing],
>   configSchema: workerConfigSchema().extend({ document: z.string() }),
>   // …
> })
> ```
>
> A file that grants filing to a worker whose flow doesn't carry it is refused when the app loads.
>
> ## Where the tasks go
>
> Every session a worker runs keeps its own board: a conversation with you, a session another
> worker posted to, or a task session. A worker files onto the board of the session it is in,
> never another's. Two sessions of one worker never see each other's tasks.
>
> A worker that files from a session it was **posted** to still answers the post as usual. The
> tasks it filed report back to that session, not to whoever posted. If the result has to come
> back to you, file the work rather than posting it.
>
> ## Splitting a task
>
> A worker given a task can split it. It files the pieces on its own task session's board, for
> its own delegates, and its task waits until the last piece ends. Then its task completes with
> what the pieces returned, or fails naming the pieces that failed for good, and the session
> above hears it. Before the last piece's result settles the task, the worker gets a turn, so
> it can give a failed piece to someone else first.
>
> ```text
> your conversation ─ task ─▶ lead's task session ─ pieces ─▶ two task sessions
>                    ◀─ "completed, with both results" ─┘
> ```
>
> Every session in the chain is yours, and only your own workers appear in it.
>
> ## How far it goes
>
> A chain stops at **five boards deep**, counting your conversation's as the first, and at
> **50 tasks under one top task**, at every depth together. A filing past either is refused,
> naming the limit, and the worker does the piece itself or tells you. Each task is a session
> and at least one model turn, so a worker that splits at every level gets expensive fast; the
> limits are where it stops.

## UPDATE · `apps/docs/docs/workforce/coordinators.md` · FIX-1794's "Handing out tasks"

Replace its first paragraph and the sentence "The coordinator has the same verbs as tools, so it
files tasks on its own when you ask it for work" with:

> A post gets an answer. When work has to be done instead, a coordinator can file a **task** for
> one of its delegates, if its file says `filing: true`. Filing works the same for every worker,
> so it has [a page of its own](./filing-work.md); what follows is how it looks from a
> coordinator.

FIX-1794's "Splitting work" subsection is not published there; it is the section above.

## UPDATE · `apps/docs/docs/workforce/workers-on-disk.md` · "What a WORKER.md says", after the `packages:` paragraph

> `filing: true` gives the worker the tools to [file tasks](./filing-work.md) for its delegates,
> and `delegates:` names them. A worker on your own flow also needs the flow to carry the filing
> capability. Leave both out and the worker files nothing.

## UPDATE · `packages/workforce/README.md` · after FIX-1794's paragraph on tasks

> Any worker can file tasks: `filing: true` and `delegates:` in its `WORKER.md`, and
> `createTaskFilingCapability()` in its flow's `uses` (the built-in `agent` and `coordinator`
> flows carry it). A task's worker can split it the same way, up to five boards deep and 50
> tasks under one top task. See [Filing work](../../apps/docs/docs/workforce/filing-work.md).

## Not changed

The task board page (`apps/docs/docs/orchestration/task-board.md`): the board itself doesn't
change, and FIX-1794's subsection on boards kept per conversation stands.

## Publication ownership

This issue publishes the new page and the three updates above. The coordinators page and FIX-1794's
sections are FIX-1791's and FIX-1794's; this issue only replaces the paragraph named. FIX-1796's
glossary defines "filing" and "task session" from this page.
