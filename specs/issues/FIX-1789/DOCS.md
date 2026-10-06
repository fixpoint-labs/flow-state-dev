# FIX-1789 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Proposed reader-facing prose for the decided answers to Q1 and Q2. The epic's
[ownership table](../../epics/FIX-1786/DOCS.md#ownership) gives this issue "which flows can run
workers"; the overview and the glossary are FIX-1796's. Code identifiers keep today's names until
FIX-1796 renames them, except `workerFlows`, which this issue renames from `kinds`. The helper names
(`workerFlowProblems`, `sharedResource`, `writeShared`) are drafts; publication uses whatever the
implementation ships.

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
>   as [above](#the-flow-decides-what-a-worker-may-declare). If you declare the keys yourself, each
>   must accept the value a worker brings: `seatId` is a string, for instance.
> - **It has a door.** Exactly one public action declares `userMessage` and takes `{ message }`,
>   so an app can talk to any worker without knowing which flow it runs on.
> - **What it shares names who wrote it.** A shared resource makes the writer a required field on
>   every entry. The startup check refuses a resource that declares that field some other way, such
>   as optional.
>
> The flows you pass in `workerFlows` are your installation's worker flows, with the built-in
> `agent` underneath. To keep a flow for the workers your installation's files define, so that a
> user can't put a worker of their own on it, mark the entry:
>
> ```ts
> const workforce = hireWorkforce(workers, {
>   workerFlows: {
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
> #### Where a worker's data lives
>
> Session, request and user state belong to one user. Org scope is shared with every member of the
> org: anything a flow writes there, every member's runs can read. A worker flow can write there
> when that is what it's built to do. Nothing stops it, because only the flow's author knows when
> org data is relevant.
>
> The built-in `agent` keeps its own working state, such as its skills, in its user's scope. Write
> your own worker flows the same way, and put what you mean to share in a shared resource.
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
> `writeShared` takes `writtenBy` from the session, never from its input, so whoever calls your
> flow can't sign as someone else. It records what your flow's code wrote: a block that writes the
> resource directly can set its own value. So `writtenBy` is as trustworthy as the worker flows your
> installation registers. An entry written without it is refused by the resource's own schema. Who
> may change an entry after it is written is not decided here; every member can read it.
>
> `writtenBy` is for display and audit. The framework never uses it to decide who may write an
> entry: that comes from the resource's scope and its ownership rules, never from this field.

## UPDATE · `apps/docs/docs/workforce/workers-on-disk.md` · "When a hire is refused", the closing paragraph

> `workerFlows` itself is checked too, once per flow, when the installation starts. A flow is
> refused when it is passed under a key that is not its own `kind`, has no door or more than one,
> doesn't accept a worker's configuration, or declares `writtenBy` some other way than a shared
> resource does. One run names every problem with every flow, and nothing is hired.
>
> A worker is refused when it names a flow kept for standard workers and isn't one. A stored
> worker refused this way is skipped at startup and reported; it stays as it is, and runs again if
> the mark is removed.

## UPDATE · `apps/docs/docs/workforce/built-in-worker.md` · "Custom worker kinds", last sentence

> Your flow is free to ignore the skills it receives. What it can't skip are the three things
> every worker flow does: [which flows can run workers](./workers-on-disk.md#which-flows-can-run-workers).

## Package README · `packages/workforce/README.md`

One line each for `workerFlowProblems`, `sharedResource`, `writeShared`, and the
`{ flow, standardOnly }` entry form of `workerFlows`, linking the section above; and one line that
`kinds` is now `workerFlows`.

Nothing else changes. The concept pages, the overview opening and the glossary are other
issues' ([epic ownership](../../epics/FIX-1786/DOCS.md#ownership)).
