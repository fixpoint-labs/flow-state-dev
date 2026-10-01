# FIX-1650 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

The shared story once, and who publishes each part. The drafts below assume the recommended
answer to Q1 and Jake's answer to Q2; a different answer to Q1 rewrites the paragraph it touches
before anything is published.

## UPDATE · `apps/docs/docs/workforce/overview.md` · a new section after "Hire a roster"

FIX-1718 publishes the first two paragraphs; FIX-1719 adds the last two.

> ## Projects, workstreams, and the seats that run them
>
> A workstream is a channel with the boards it holds: one place for the conversation about a
> piece of work, and the rows people claim to do it. You declare it the way you declare any
> channel, in a `CHANNEL.md`.
>
> A project groups workstreams. It is a channel too, one whose charter is the project's brief
> and whose conversation is where the project as a whole is discussed. Each workstream names the
> project it belongs to. There is no projects folder and no project type: a project is
> something your tree already holds, read a particular way.
>
> Two seats help one person run an organization. The chief of staff is who you ask what is
> going on; it reads the boards and posts to a project's channel. Ops changes who works there:
> ask it for another seat and it hires one; ask it for one fewer and it puts the request in
> front of you to approve, and nothing is removed until you do. Every seat it hires is yours. Both are seats on the built-in
> agent kind, declared under `org/workers/`, and a Lab that doesn't add them doesn't have them.
>
> Channels themselves are still declared on disk. Ops reads them; it does not open or close them.

## Ownership

What [ER-18](BUSINESS-RULES.md#the-closure) holds the closure to.

| Material | Publisher | Specific draft |
|---|---|---|
| The shared section's project and workstream paragraphs | FIX-1718, after its behaviour is verified | This document |
| The shared section's org-seat and channel paragraphs | FIX-1719, after its behaviour is verified | This document |
| How to declare a project and name it from a workstream; what a workstream is | FIX-1718 · `apps/docs/docs/workforce/channels.md` | Its `DOCS.md` |
| Shift Manager's project level and PROJECTS tree; removing the matching "What isn't here yet" lines | FIX-1718 · `labs/shift-manager/README.md` | Its `DOCS.md` |
| The CoS and Ops seats, how a Lab opts in, Ops hiring without asking and the approval on every fire | FIX-1719 · a new page under `apps/docs/docs/workforce/`, name its spec's call | Its `DOCS.md` |
| Finding and repairing a seat whose kind is gone | FIX-1621 · `apps/docs/docs/workforce/durable-hire.md` | Its `DOCS.md` |

Publish each part with its implementation, never because this spec merged. Published prose says
"seat" and "agent kind", never "worker" as a noun ([ER-13](BUSINESS-RULES.md#what-no-child-may-do));
`org/workers/` is a path and stays. No unchanged page is copied here.
