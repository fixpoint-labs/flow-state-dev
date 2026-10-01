# FIX-1719 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

One new page, four updates, and the epic's shared section. PR 1 publishes the org-seat paragraphs;
PR 2 the page and the shared section. Voice: "seat" and "agent kind", never "worker" as a noun
(ER-13); `org/workers/` and `WORKER.md` are paths and stay. No em-dash habit, no "seamless".

## UPDATE · `apps/docs/docs/workforce/workers-on-disk.md` · "The tree" (PR 1)

Add `org/workers/` to the example tree and, after "Three workers in two teams…":

> A seat the whole organization shares, rather than one team, sits under `org/workers/`. These
> are rare: a chief of staff, an operations seat. Its `WORKER.md` reads exactly like a team
> seat's.

## UPDATE · same page · "A worker's identity" (PR 1)

After the first paragraph:

> A seat under `org/workers/` has no team, so its id is its folder name alone:
> `org/workers/ops/` is `ops`. A team seat's id always has a dot and an org seat's never does,
> so `ops` and `engineering.ops` are two different seats.

## UPDATE · same page · "What is passed over in silence" (PR 1)

Replace "a `workers/` folder at the top of the tree" with "a `workers/` folder directly under the
root", and add after the paragraph's last sentence:

> `org/workers/<name>/` is a seat slot like `teams/<team>/workers/<name>/`. A folder there with
> no `WORKER.md` is reported in `errors`, not skipped. An org seat reads the organization's
> skills, packages and references, then its own folder's. There is no team level above it.

## UPDATE · `apps/docs/docs/workforce/documents-on-disk.md` (PR 1)

Add `org/workers/build/WORKER.md` to the tree the address table reads. Replace the sentence at
"Seats are read from `teams/<team>/workers/<name>/`, so a reference under
`org/workers/<name>/references/` … no seat reaches it" with:

> A reference under `org/workers/<name>/references/` belongs to that org seat. The seat reaches
> it, along with every organization-level reference; team seats don't.

Mirror both in `packages/workforce/README.md`'s matching rows.

## CREATE · `apps/docs/docs/workforce/org-seats.md` (PR 2)

Sidebar: `workforce/org-seats`, after `workforce/durable-hire`, because it builds on hiring at
runtime. Label "Chief of staff and Ops".

> ---
> title: Chief of staff and Ops
> sidebar_label: Chief of staff and Ops
> description: "Two seats a Lab can add so one person can ask what's going on and change who works there, with fires approved in Inbox."
> ---
>
> # Chief of staff and Ops
>
> When one person runs a whole workforce, two questions come up every day: who is working on
> what, and can I get one more seat (or one fewer)? Two optional seats answer them.
>
> The **chief of staff** is who you ask what's going on. It reads the roster and posts to a
> project's channel. It can't hire or fire anyone.
>
> **Ops** changes who works here. Ask it for a seat of a kind your app registers and it hires
> one. Ask it to fire a seat and it puts the request in your Inbox; nothing changes until you
> approve. Every seat Ops hires is stored in your own organization and comes back after a
> restart.
>
> Both are ordinary seats on the built-in agent kind. You add them by adding two files.
>
> ## Add them
>
> ```
> workforce/
>   org/
>     workers/
>       chief-of-staff/
>         WORKER.md
>       ops/
>         WORKER.md
> ```
>
> ```md
> ---
> description: Hires and fires seats when the person asks.
> flow: agent
> tools: [hire, fire]
> ---
> You change who works in this organization, and only when asked...
> ```
>
> Ops's tools come from the `seat-hire` capability, so install it on the agent kind once:
>
> ```ts
> const agent = defineAgentWorkerFlow({
>   uses: [
>     createWorkforceCapability({ roster, inventory: true }),
>     createSeatHireCapability({
>       kinds,
>       register: (seat, pin) => registrar.register(seat, pin),
>       unregister: (id) => registrar.unregister(id),
>       allowKinds: ["coder", "reviewer"],
>       askBefore: ["fire"],
>     }),
>   ],
> });
> ```
>
> A Lab that adds neither file has neither seat. Installing the capability gives `hire` and
> `fire` only to a seat whose `tools:` names them.
>
> ## What asks first
>
> `askBefore` lists the changes that wait for a person. With `["fire"]`, a hire happens at once
> and a fire waits for Approve in Inbox. Deny leaves the seat as it was, and Ops is told. If the
> app stops while a fire is waiting, the request is still there after the restart.
>
> Want every hire approved too? Use `askBefore: ["hire", "fire"]`. Seats already hired stay.
> Leave the option out and nothing asks, which is how the capability behaved before.
>
> A change that asks first needs durable execution, because the request has to survive a
> restart. Without it, the tool refuses that change rather than making it unasked.
>
> ## What Ops can't do
>
> - Fire the chief of staff, itself, or any seat declared in a `WORKER.md`. Remove those by
>   deleting the folder.
> - Hire a kind outside `allowKinds`, or a kind your app doesn't register.
> - Open, close or invite to a channel. Channels are still declared on disk.
>
> ## Related pages
>
> - [Hiring while the app runs](./durable-hire.md): where hired seats are stored and read back.
> - [Workers on disk](./workers-on-disk.md): what a `WORKER.md` says.

## UPDATE · `apps/docs/docs/workforce/durable-hire.md` · "The ready-made hire and fire handlers" (PR 2)

After the first paragraph:

> Mounted as actions, the handlers never ask anyone: whoever calls the action has already
> decided. The capability's tools can, with `askBefore`; see
> [Chief of staff and Ops](./org-seats.md#what-asks-first).

`packages/workforce/README.md`: one row for `askBefore` in `createSeatHireCapability`'s options.

## UPDATE · `apps/docs/docs/workforce/overview.md` · the epic's shared section (PR 2)

FIX-1719 publishes the third and fourth paragraphs of
[the epic's draft](../../epics/FIX-1650/DOCS.md), with the third reconciled to the answered
policy:

> Two seats help one person run an organization. The chief of staff is who you ask what is
> going on; it reads the roster and posts to a project's channel. Ops changes who works there:
> ask it for another seat and it hires one; ask it for one fewer and it puts the request in
> front of you to approve. Every seat it hires is yours. Both are seats on the built-in agent
> kind, declared under `org/workers/`, and a Lab that doesn't add them doesn't have them.

## Release notes

`@flow-state-dev/workforce`, `minor`, in each PR: PR 1 "Seats declared under `org/workers/` now
load, with their folder name as their id." PR 2 "`createSeatHireCapability` takes `askBefore`
to put named changes behind a person's approval."
