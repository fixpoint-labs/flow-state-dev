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

## CREATE · `labs/app-lab/README.md` · opening

Publisher: FIX-1662. How to open a Lab, and the run command, are its own draft.

> # App Lab
>
> The app you use a Workforce Lab through. Point it at a Lab's Workforce tree (the folder of
> teams, workers and channels the Lab declares) and an organization, and it gives you one
> place to work: what needs you, the Lab's channels, and which seats are on shift down the
> left; a channel's stream, board, brief and results in the middle; and the run a seat is in
> on the right.
>
> Five destinations sit in the rail: projects, workstreams, chat, attention and resources.
> Chat and resources show what your tree declares today. Projects, workstreams and attention
> are reachable now and say plainly what arrives there and when; they fill in as those parts
> of Workforce ship.
>
> App Lab isn't a debugger. Each run links its full trace in the devtool.

## UPDATE · `labs/README.md` · the directory table

Publisher: FIX-1662. One row: `app-lab/`, *the app a Workforce Lab is used through*, linking
its README.

## Ownership

| Material | Publisher | Specific draft |
|---|---|---|
| The token paragraph and example above | FIX-1655 | This document; the full token list in its `DOCS.md` |
| The design-system package README and the registry components' colour notes in `packages/ui/README.md` | FIX-1655 | Its `DOCS.md` |
| The App Lab README opening above, how to open a Lab, the `labs/README.md` row | FIX-1662 | This document and its `DOCS.md` |
| Nothing in `apps/docs` about App Lab itself | — | App Lab is a private lab, not a published product |

Publish each specific with its implementation. The App Lab opening waits until every
destination it names is reachable.
