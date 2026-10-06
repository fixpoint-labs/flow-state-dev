# FIX-1789 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Proposed reader-facing prose for the recommended answers to Q1 and Q2. The epic's
[ownership table](../../epics/FIX-1786/DOCS.md#ownership) gives this issue "which flows can run
workers"; the overview and the glossary are FIX-1796's. Code identifiers keep today's names until
FIX-1796 renames them. If the epic records the wrapper, the first block's code changes shape and
the rules stay; if it records Q2 the other way, the paragraph marked **Q2** is replaced by the
limit given under it. The helper names (`workerFlowProblems`, `sharedResource`, `writeShared`)
are drafts; publication uses whatever the implementation ships.

## CREATE · `apps/docs/docs/workforce/workers-on-disk.md` · new section "Which flows can run workers", after "The flow decides what a worker may declare"

> ### Which flows can run workers
>
> A worker runs on a flow. Not every flow can run one: your installation says which flows are
> worker flows, and checks each one when it starts, before any worker runs. A worker that names a
> flow your installation didn't register is refused, by name.
>
> A worker flow does three things:
>
> - **It takes the standard configuration.** Its `configSchema` composes `workerConfigSchema()`,
>   as [above](#the-flow-decides-what-a-worker-may-declare).
> - **It has a door.** Exactly one public action declares `userMessage` and takes `{ message }`,
>   so an app can talk to any worker without knowing which flow it runs on.
> - **It keeps a worker's state private.** Session, request and user state belong to one user.
>   Anything kept at org scope is read by every member, so a worker flow keeps nothing there
>   except a shared resource, where every entry names who wrote it.
>
> The flows you pass in `kinds` are your installation's worker flows, with the built-in `agent`
> underneath. To keep a flow for the workers your installation's files define, so that a user
> can't put a worker of their own on it, mark the entry:
>
> ```ts
> const seats = hireWorkforce(workers, {
>   kinds: {
>     triage: triageFlow,
>     coordinator: { flow: coordinatorFlow, standardOnly: true },
>   },
> });
> ```
>
> A worker that names no flow runs on `agent`, and the mark is checked after that. So if you keep
> `agent` for standard workers, a user's own worker that names no flow is refused, and the message
> names `agent`. Replacing `agent` with a flow of your own keeps the mark you wrote.
>
> Writing a library of worker flows? Check each one in your own tests, without an installation:
>
> ```ts
> import { workerFlowProblems } from "@flow-state-dev/workforce";
>
> expect(workerFlowProblems("triage", triageFlow)).toEqual([]);
> ```
>
> #### Sharing something from a worker
>
> To let a worker write something every member can read, declare a shared resource and write
> through the helper. The entry records the user, and the worker that wrote it:
>
> ```ts
> import { sharedResource, writeShared } from "@flow-state-dev/workforce";
>
> const notes = sharedResource("team-notes/*", { text: z.string() });
>
> // inside a block that declares `resources: { notes }`
> await writeShared(ctx, "notes", "launch", { text: "Launch moved to Friday." });
> // stored: { text: "Launch moved to Friday.", writtenBy: { userId: "alice", workerId: "researcher" } }
> ```
>
> `writtenBy` comes from the session, never from the input, so a caller can't sign as someone else.
> An entry written without it is refused by the resource's own schema. Who may change an entry
> after it is written is not decided here; every member can read it.
>
> **Q2.** A worker flow can't write the org's shared state record (`ctx.org.state`). The write is
> refused when it runs, naming the flow, because every member's run reads that record and nothing
> in the flow's definition would show it. Use a shared resource instead.
>
> *If Q2 goes the other way, this paragraph instead reads:* Don't write the org's shared state
> record (`ctx.org.state`) from a worker flow. Every member's run reads it, and the startup check
> can't see a write that nothing declares.

## UPDATE · `apps/docs/docs/workforce/workers-on-disk.md` · "When a hire is refused", the closing paragraph

> `kinds` itself is checked too, once per flow, when the installation starts. A flow is refused
> when it is passed under a key that is not its own `kind`, has no door or more than one, or keeps
> anything at org scope other than a shared resource. One run names every problem with every flow,
> and nothing is hired.
>
> A worker is refused when it names a flow kept for standard workers and isn't one. A stored
> worker refused this way is skipped at startup and reported; it stays as it is, and runs again if
> the mark is removed.

## UPDATE · `apps/docs/docs/workforce/built-in-worker.md` · "Custom worker kinds", last sentence

> Your kind is free to ignore the skills it receives. What it can't skip are the three things
> every worker flow does: [which flows can run workers](./workers-on-disk.md#which-flows-can-run-workers).

## Package README · `packages/workforce/README.md`

One line each for `workerFlowProblems`, `sharedResource`, `writeShared`, and the
`{ flow, standardOnly }` entry form of `kinds`, linking the section above.

Nothing else changes. The concept pages, the overview opening and the glossary are other
issues' ([epic ownership](../../epics/FIX-1786/DOCS.md#ownership)).
