# FIX-1650 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

The shared story once, and who publishes each part. The drafts below assume the recommended
answers to Q1 and Q2; a different answer rewrites the paragraph it touches before anything is
published.

## UPDATE · `apps/docs/docs/workforce/overview.md` · a new section after "Hire a roster"

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
> ask it for another worker, or one fewer, and it puts the request in front of you to approve.
> Nothing changes until you do. Both are ordinary workers on the built-in kind, declared under
> `org/workers/`, and a Lab that doesn't add them doesn't have them.
>
> Channels themselves are still declared on disk. Ops reads them; it does not open or close them.

## Ownership

| Material | Publisher | Specific draft |
|---|---|---|
| The shared section above | FIX-1719, after the assembled behaviour is verified | This document |
| How to declare a project and name it from a workstream; what a workstream is | FIX-1718 · `apps/docs/docs/workforce/channels.md` | Its `DOCS.md` |
| Shift Manager's project level and PROJECTS tree; removing the matching "What isn't here yet" lines | FIX-1718 · `labs/shift-manager/README.md` | Its `DOCS.md` |
| The CoS and Ops seats, how a Lab opts in, the approval on every hire and fire | FIX-1719 · a new page under `apps/docs/docs/workforce/`, name its spec's call | Its `DOCS.md` |
| Finding and repairing a seat whose kind is gone | FIX-1621 · `apps/docs/docs/workforce/durable-hire.md` | Its `DOCS.md` |

Publish each specific with its implementation. The shared section waits until all three
promises in it hold; it is not published because this spec merged. No unchanged page is copied
here.
