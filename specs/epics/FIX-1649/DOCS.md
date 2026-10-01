# FIX-1649 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

The shared narrative, drafted once. Each publisher reconciles it against tested behaviour on
`main` and publishes it through the `docs-writer` and `docs-editor` pass; nothing here is
published because this spec merged. Property names below were checked against
`packages/react/src/components` on `main` at 70f777d; the publisher re-checks them.

## UPDATE · `apps/docs/docs/workforce/ui.md` · Styling, after the custom-properties list

Publisher: FIX-1655, once its token mapping ships.

> ### One set of tokens for everything on screen
>
> If your app also renders the `@flow-state-dev/ui` components (messages, tool calls,
> approval cards), you don't need a second theme for the navigator and panels. Define your
> colours once as the semantic tokens those components read, then point the navigator's and
> panels' properties at the same tokens:
>
> ```css
> .app-shell {
>   --fsd-nav-fg: var(--color-foreground);
>   --fsd-nav-muted-fg: var(--color-muted-foreground);
>   --fsd-nav-selected-bg: var(--color-accent);
>   --fsd-nav-selected-fg: var(--color-accent-foreground);
>   --fsd-nav-guide: var(--color-border);
>   --fsd-panel-fg: var(--color-foreground);
>   --fsd-panel-muted-fg: var(--color-muted-foreground);
> }
> ```
>
> Change a token and every component follows. Nothing here needs a class override or an edit
> to a component you copied in; if a component ignores a token, that's a bug in the component.

## UPDATE · `labs/shift-manager/README.md` · opening

Publisher: FIX-1662. How to open a Lab, and the run command, are its own draft.

> # App Lab
>
> The app you use a Workforce Lab through. Point it at a Lab's Workforce tree (the folder of
> teams, workers and channels the Lab declares) and an organization, and it gives you one
> place to work.
>
> It opens on Chief of Staff: a summary of what needs you and what is running, and the Lab's
> chief of staff to talk to.
>
> The sidebar is where you are and what needs you: the organization, a search that jumps
> anywhere, an Inbox of the approvals and questions waiting on you, a list of every task in
> flight, a Roster of who is on shift, on call or off shift, your projects with their
> workstreams, and each team as a row of squares, one per worker. A switch at the bottom flips
> between the day and night look. Answer an ask in the Inbox, or reply to the worker who raised it; the reply
> goes into that worker's session.
>
> The middle is whatever you opened. A project shows its workstreams on one board. A
> workstream is a channel: workers post as they go, and a message addressed to one of them
> (`@builder`) goes straight into that worker's session. A task shows one worker's live
> session, its diff and its checks, and lets you interrupt it or hand it off. The panel on the
> right follows along, with the team and its tasks at a workstream and the task's details at
> a task.
>
> Anything a part of Workforce hasn't shipped yet says so, and says what arrives there. App
> Lab isn't a debugger: each task links its full trace in the devtool.

## UPDATE · `labs/README.md` · the directory table

Publisher: FIX-1662. One row: `shift-manager/`, *the app a Workforce Lab is used through*, linking
its README.

## Ownership

| Material | Publisher | Specific draft |
|---|---|---|
| The token paragraph and example above | FIX-1655 | This document; the full token list in its `DOCS.md` |
| The design-system package README and the registry components' colour notes in `packages/ui/README.md` | FIX-1655 | Its `DOCS.md` |
| The App Lab README opening above, how to open a Lab, the `labs/README.md` row | FIX-1662 | This document and its `DOCS.md` |
| The README's task sentences above, checked against what the task level ships | FIX-1664 | This document and its `DOCS.md` |
| The README's Chief of Staff sentence above | FIX-1722 | This document and its `DOCS.md` |
| The README's Roster and TEAMS sentences above | FIX-1723 | This document and its `DOCS.md` |
| The README's day and night switch sentence above | FIX-1725 | Its issue's *Done when* |
| Nothing in `apps/docs` about App Lab itself | — | App Lab is a private lab, not a published product |

Publish each specific with its implementation. The App Lab opening waits until every level
it names is reachable, so FIX-1662 publishes it without the task sentences and FIX-1664 adds
them.
