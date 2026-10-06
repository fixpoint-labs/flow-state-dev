# FIX-1795 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

This issue owns `library.md` ([epic ownership](../../epics/FIX-1786/DOCS.md#ownership)) and the
library's lines in the Shift Manager page and the package README. The epic's overview opening
already says a copy doesn't change when its template does; nothing here repeats it. Prose follows
the outsider rule ([`user-docs.md`](../../../docs/contributing/user-docs.md)). Reconcile it with
the shipped names and refusals, and with Q1 and Q2's answers (marked), before publishing.

| Shipped names | |
|---|---|
| **Pinned** ([PLAN.md](PLAN.md#pinned-names--the-only-three)) | `workforce/library/*` · `fromTemplate: { templateId, version, digest }` · `version` · FIX-1788's `createWorkforceClient`, `ensureWorkerSession`, `findWorkerSession` |
| **Drafts**, reconciled with the shipped code before publishing | `library` on the hire blocks and its `publish`, `add`, `takeUpdate`, `remove`, `list` · the action names · the hire-block factory's name (`createWorkerHireBlocks`, FIX-1788's draft) |

Voice watch for this page: no em-dash as a connector, no "seamless" or "powerful", introduce
*template*, *roster* and *standard worker* in plain words on first use, and say "user", never
"person" or "seat".

## CREATE · `apps/docs/docs/workforce/library.md`

Sidebar: `apps/docs/sidebars.ts`, right after `"workforce/durable-hire"`, since a copy is a kind
of hire and that page comes first. Frontmatter `sidebar_label: Worker library`. Linked from
`durable-hire.md` → "Forking a standard worker" (one line: "To share a worker with your org, see
[the worker library](./library.md).") and, once the epic's overview opening publishes, from its
sentence about the library.

> # The worker library
>
> Your workers are yours alone: nobody else in your org can see them. When you build one a
> teammate would want, you share it through your org's **worker library**.
>
> Sharing a worker publishes a **template**: a copy of its configuration that anyone in your org
> can browse. When a teammate adds the template, they get a new worker of their own, built from
> that configuration. It works for them and acts as them, the same as any worker they hired.
>
> ![A shared library band between two users' private areas. Alice publishes her worker's configuration up into the band as a template; her sessions and memory stay in her area. Bob adds the template, and a worker of his own appears in his area](./library-template-and-copy.svg)
>
> ## What a template carries
>
> A template carries the worker's configuration: the flow it runs on, its instructions, and the
> names of its skills, tools, packages and documents, plus any settings its flow takes. It never
> carries the worker's conversations, anything it remembers, or skills it wrote for itself.
> Those stay with you.
>
> Each template names who published it. Your org's library is your org's only: a template is
> never visible in another org, even to someone who belongs to both.
>
> Standard workers, the ones your installation's files define, aren't in the library, because
> every user already has them. To share a change to one,
> [fork it](./durable-hire.md#forking-a-standard-worker) and publish the fork.
>
> ## Adding a template
>
> The library shows what each template can reach: its tools, skills, packages, documents and
> collections. That is what you're giving a worker that acts as you, so check it before you add.
>
> Adding a template is a hire. Your new worker gets the id you give it, or the template's name,
> and the same checks run as for any hire: a flow your installation doesn't run workers on, or
> keeps for standard workers, is refused with the reason, and nothing is added. You can add the
> same template twice; you get two workers with two ids.
>
> ## Your copy doesn't change on its own
>
> Your worker runs the configuration you added, and only that, until you choose otherwise.
> If the publisher improves the template, nothing about your worker changes. So nobody else can
> alter what runs with your access.
>
> When a newer version exists, your roster marks your worker with it. *(Q2: how the mark reaches
> you.)* Before you take it, the update lists anything the new version can reach that your
> worker can't. Taking the update replaces your worker's configuration with the new version.
> Your worker keeps its id, its conversations and what it remembers, and its conversations carry
> on with the new version. If you edited your worker after adding it, the update warns you that
> taking it replaces your edits. To keep your version and try the new one, add the template
> again as a second worker.
>
> ## Changing or removing a template
>
> Only the user who published a template can publish a new version of it or remove it.
> *(Q1: who can change or remove a template.)* A new version always runs on the same flow as the
> template. Publishing a worker that runs on a different flow makes a new template instead.
> Removing a template takes it out of the library. Every worker added from it keeps running,
> unchanged.
>
> Variants of one worker, such as a Codex, a Claude and a Cursor researcher that share core
> instructions, are separate templates. Each carries its own copy of those instructions, and so
> does each worker added from it.
>
> ## In your app
>
> The library's actions are blocks you wire into a flow you guard. They come with the hire
> blocks:
>
> ```ts
> import { defineFlow } from "@flow-state-dev/core"
> import { createWorkerHireBlocks } from "@flow-state-dev/workforce"
>
> const { hire, fork, fire, library } = createWorkerHireBlocks({ workerFlows })
>
> defineFlow({
>   kind: "roster-admin",
>   actions: {
>     hire: { block: hire }, fork: { block: fork }, fire: { block: fire },
>     publishTemplate: { block: library.publish },
>     addFromLibrary: { block: library.add },
>     takeTemplateUpdate: { block: library.takeUpdate },
>     removeTemplate: { block: library.remove },
>   },
> })
> ```
>
> A turn that publishes, adds, takes an update or removes names the collection it wrote, the
> library or the roster, so a view that listens for written collections reloads it.
>
> A worker added from the library is a worker like any other. Talk to it with
> `createWorkforceClient({ userId, baseUrl }).ensureWorkerSession({ worker: "release-notes" })`.

The SVG ships as the docs' own file, in the boundary style of the workforce pages: two private
areas, one shared band, configuration crossing up on publish and down on add, sessions and
memory drawn staying behind.

## UPDATE · `apps/docs/docs/shift-manager/overview.md` · "What you see", the **Roster** row

> | **Roster** | Every worker, grouped as on shift (running a task), on call (waiting on you), or off shift. A worker you added from your org's library shows when a newer version exists, with *Take update*. *Library* lists your org's templates: *Add* one to your roster, or *Share* a worker of your own. |

(P2. Q2's answer may change the second sentence.)

## UPDATE · `packages/workforce/README.md` · after the hire blocks

> ### The worker library
>
> The hire blocks also return `library`: `publish`, `add`, `takeUpdate`, `remove` and `list`
> blocks over your org's library at `workforce/library/*`. A template is a worker's
> configuration only, and a new version keeps its flow. Adding one is a hire, through the same
> checks. A copy never changes unless its owner takes an update. Only a template's publisher
> changes or removes it. See
> [the worker library](https://flow-state.dev/docs/workforce/library).

No other page changes: the overview's library sentence is the epic's and publishes with FIX-1796.
