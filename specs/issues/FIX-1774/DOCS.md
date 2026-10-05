# FIX-1774 · Docs

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

One new page and three updates. Write "worker", never "seat", in every sentence added. Tool names
from FIX-1779 are as its spec pins them; reassign is FIX-1780's.

## 1 · New page `apps/docs/docs/workforce/coordinator.md` — sidebar under Workforce, after *Chief of staff*

> ---
> sidebar_label: Coordinator
> ---
>
> # The coordinator
>
> Most teams want one worker people can hand a request to and trust that it lands somewhere. That's
> a coordinator. It routes the work to the right mailbox, hires when nobody fits, sets up a mailbox
> when nothing can hold the work, and keeps track of what it filed.
>
> You make a worker a coordinator by composing one capability:
>
> ```ts
> import { createCoordinatorCapability } from "@flow-state-dev/workforce";
>
> const coordinator = createCoordinatorCapability({ roster, inventory, hire, open, projects });
> ```
>
> Then name the tools it may use in its `WORKER.md`, and the kinds it may hire:
>
> ```md title="workforce/org/workers/chief-of-staff/WORKER.md"
> ---
> flow: agent
> tools: [hire, fire, rehire, brokenSeats, setUpMailbox, subscribeWorkers,
>         unsubscribeWorkers, fileTask, reassignTask, cancelTask, createProject,
>         setWorkstreams]
> ---
>
> You coordinate this organization. You may hire `coder` workers for code and
> `agent` workers for anything else; give each hire a one-line description.
> ```
>
> ## What it does with a request
>
> 1. **Routes it.** It files a task on the task list of the mailbox where the work belongs, for the
>    worker who should do it. That worker starts.
> 2. **Staffs it.** If nobody fits, it hires one worker, describes what the worker is for, and
>    subscribes it to the mailbox.
> 3. **Makes room.** If no mailbox fits, it sets one up with a task list on your project.
> 4. **Follows through.** When a task fails or gets stuck, it hears about it and reassigns it or
>    tells you.
> 5. **Tidies up.** It repairs broken workers and lets idle ones go when the work is done. Letting a
>    worker go waits for your approval.
>
> If you leave choices to it ("I don't care how"), it picks sensible defaults and tells you which.
> Asking twice doesn't hire twice. And when nothing it can do would start the work, it says what's
> missing rather than hiring someone and stopping.
>
> ## What it sees
>
> Every turn, the coordinator sees your organization's projects, its mailboxes and what each is
> for, which workers work each task list, and where every task it filed stands. It doesn't see
> other organizations, or workers a member hired for themselves.
>
> ## Writing your own instructions
>
> The capability carries the coordinator's job as instructions. To write your own, turn them off
> with `coordinator.presets({ job: false })` and keep the tools and the view.

## 2 · Update `apps/docs/docs/workforce/chief-of-staff.md` — after the opening paragraph

> A chief of staff is usually also your coordinator: compose the
> [coordinator capability](./coordinator.md) and it routes requests, hires and sets up mailboxes
> as well as answering questions about who works here.

## 3 · Update `labs/shift-manager/README.md` — the `devteam` bullet under *Team profiles*

After "The EM answers every line posted in a project's room.", add:

> The chief of staff is the team's coordinator. Ask it for something to be built and it files a
> task for the coder, who starts on it. Ask for work nobody does and it hires someone for it.
> Start a project and it sets up a mailbox for each kind of work.

## 4 · Update `apps/docs/docs/shift-manager/overview.md` — the `devteam` paragraph

After "Two projects exist from the start, Storefront and Platform.", add:

> Shift Coordinator talks to the team's coordinator. Hand it a request and it gets the work to a
> worker who can do it, hiring one if it has to, and the run shows up under Tasks.

## Not changed

- The hire, mailbox set-up and follow-through references: their own issues document their tools.
