# FIX-1655 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Proposed reader-facing prose. The implementer reconciles it with what P1 ships, then publishes
through `docs-writer` and `docs-editor`. The shared token paragraph for
`apps/docs/docs/workforce/ui.md` is drafted in the [epic's DOCS.md](../../epics/FIX-1649/DOCS.md)
and this issue publishes it unchanged except where noted below; it is not repeated here.

## UPDATE · `apps/docs/docs/ui/overview.md` · new section after "How distribution works"

> ## Colours and theming
>
> Registry components never name a colour directly. They use tokens, CSS variables with names
> that say what the colour is for: `background`, `foreground`, `muted-foreground`,
> `destructive` and so on. Change a token in your stylesheet and every component that reads it
> follows, with no edit to the files you copied in.
>
> Status gets its own tokens:
>
> | Token | Used for |
> |---|---|
> | `success` | done, approved, a passing result |
> | `warning` | something is off but nobody is being asked: a blocked task, a stuck request |
> | `info` | running, in progress, informational |
> | `attention` | a person must act: a tool call waiting for approval, a task parked for review |
> | `destructive` | failed, rejected, an error |
>
> Each has a `-foreground` partner for text on a filled background. `warning` and
> `attention` are separate on purpose, so an app can make "waiting on you" stand out without
> every warning looking like a request.
>
> Defaults come with the components. The first `fsdev ui add` of a component that uses a status
> token also adds the `tokens` item, which writes every token, light and dark, into your
> stylesheet. The defaults are plain: green, amber, blue, yellow and red.
>
> ```bash
> fsdev ui add tool task-plan   # also adds tokens
> ```
>
> To restyle, override the tokens after them:
>
> ```css
> :root {
>   --color-attention: #e8f551;
>   --color-attention-foreground: #1b1a15;
>   --color-warning: #a83e28;
> }
> .dark {
>   --color-attention: #e8f551;
> }
> ```
>
> **Upgrading copies from before the status tokens existed.** Re-add the components you use,
> then run `fsdev ui add tokens` once. A component copied in fresh against a stylesheet
> without the tokens renders its status parts with no colour, not an error.

## UPDATE · `apps/docs/docs/workforce/ui.md` · Styling, after the custom-properties list

Publish the epic's paragraph and example as drafted, with one sentence appended after
*"that's a bug in the component"*:

> The `@flow-state-dev/ui` [colours and theming](../ui/overview.md#colours-and-theming) section
> lists the tokens, including the status ones.

## UPDATE · `packages/ui/README.md` · after "Installation"

> ### Colours
>
> Components read colours only from tokens. `fsdev ui add tokens` (added automatically with the
> first component that needs it) writes the defaults into your stylesheet, including the status
> tokens `success`, `warning`, `info` and `attention`. Override any of them to restyle. See
> [colours and theming](https://flow-state.dev/docs/ui/overview#colours-and-theming).

## CREATE · `labs/design-system/README.md`

> # Design system
>
> The look shared by the Workforce Labs' app, App Lab: a light and a dark theme over the tokens
> FSD's components already read. It holds values only. There are no components here; the app
> gets those from `@flow-state-dev/react` and the `@flow-state-dev/ui` registry, unedited.
>
> ```css
> @import "@flow-state-dev/design-system/app-lab.css";
> ```
>
> The light theme applies by default. Put `class="dark"` on an ancestor for the dark one. The same
> stylesheet points the navigator's and panels' `--fsd-nav-*` and `--fsd-panel-*` properties at
> the tokens, so they match the cards.
>
> Two rules the values keep. Yellow (`attention`) means only that a person must act. Corners are
> square and nothing casts a shadow.
>
> Fonts are named, not bundled: Space Grotesk for the interface, Archivo for display, IBM Plex
> Mono for labels and ids. Load them in your app, or the system fallbacks show.
>
> Nothing in FSD's own packages may carry one of these values; a check fails if one does. The
> values are drafts until the final design hand-back.

## UPDATE · `labs/README.md` · the directory table

One row: `design-system/`, *the light and dark theme App Lab loads over FSD's component tokens*,
linking its README.

## Ownership

This issue publishes every operation above, in P1. P2 removes the README's last sentence.
