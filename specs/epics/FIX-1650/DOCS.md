# FIX-1650 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

The shared story once, and who publishes each part. The drafts below follow Jake's answers to
Q1 and Q2, the per-person baseline and the template default [still open](DECISIONS.md#pending); a different answer to one of
those rewrites the sentence it touches before anything is published.

## UPDATE · `apps/docs/docs/workforce/overview.md` · a new section after "Hire a roster"

FIX-1718 publishes the first two paragraphs; FIX-1719 adds the last two.

> ## Projects, workstreams, and the seats that run them
>
> A workstream is a channel with the boards it holds: one place for the conversation about a
> piece of work, and the rows people claim to do it. You declare it the way you declare any
> channel, in a `CHANNEL.md`.
>
> A project groups workstreams. It is a record your organization keeps: a title, a status, an
> owner, and links, stored once and visible to everyone in the organization. You don't write a
> file for each project. Your Lab declares one talk channel shape for projects, a `CHANNEL.md`
> with `mintFor: projects`, and each new project gets a talk channel in that shape. Your talk
> channel about a project is yours: someone else who joins the project gets their own, and the
> project record is what you share.
>
> One seat helps one person run an organization. The chief of staff is who you ask what is
> going on; it reads the boards and creates projects when you ask for one. It also changes who works there:
> ask it for another seat and it hires one; ask it for one fewer and it puts the request in
> front of you to approve, and nothing is removed until you do. Every seat it hires is yours, and other seats ask it rather than
> hiring for themselves. It is a seat on the built-in agent kind, declared under `org/workers/`,
> and a Lab that doesn't add it doesn't have one.
>
> Workstream channels are still declared on disk. The chief of staff reads them; it never
> opens, closes, or renames a channel. A project's talk channel appears because the project
> was created, not because a seat opened it.

## Ownership

What [ER-18](BUSINESS-RULES.md#the-closure) holds the closure to.

| Material | Publisher | Specific draft |
|---|---|---|
| The shared section's project and workstream paragraphs | FIX-1718, after its behaviour is verified | This document |
| The shared section's org-seat and channel paragraphs | FIX-1719, after its behaviour is verified | This document |
| How to declare the projects collection and its talk template; how a person joins a project; how a workstream belongs to a project; what a workstream is | FIX-1718 · `apps/docs/docs/workforce/channels.md` | Its `DOCS.md` |
| Shift Manager's project level and PROJECTS tree; removing the matching "What isn't here yet" lines | FIX-1718 · `labs/shift-manager/README.md` | Its `DOCS.md` |
| The CoS seat, how a Lab opts in, CoS creating projects, hiring without asking and the approval on every fire | FIX-1719 · a new page under `apps/docs/docs/workforce/`, name its spec's call | Its `DOCS.md` |
| Finding and repairing a seat whose kind is gone | FIX-1621 · `apps/docs/docs/workforce/durable-hire.md` | Its `DOCS.md` |

Publish each part with its implementation, never because this spec merged. Published prose says
"seat" and "agent kind", never "worker" as a noun ([ER-13](BUSINESS-RULES.md#what-no-child-may-do));
`org/workers/` is a path and stays. No unchanged page is copied here.
