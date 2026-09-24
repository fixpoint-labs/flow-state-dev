# FIX-1561 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Three destinations. Only the changed prose is drafted; everything around it stays. Voice: no
internal issue numbers in `apps/docs`, and introduce "leaf" the first time it appears.

## UPDATE · `packages/react/README.md` · FlowNavigator, the two slot paragraphs

Replaces the paragraph that lists the slots, and the `leafToolbar` paragraph after it.

> The package brings no CSS framework and no icon set. Style the rows by setting the
> `--fsd-nav-*` CSS custom properties on any ancestor, and fill in your own affordances through
> `slots`: `sectionHeader` beside a section label, `rowTrailing` at the end of any row,
> `leafToolbar` at the end of an open leaf's row, and `emptySection` for a section whose kinds
> the server does not have.
>
> A leaf is a row whose sessions you can open: a singleton's row, or one copy under a
> collection. While a leaf is open, `leafToolbar` is handed its session list, a `refresh` for
> it, and the flow-list entry the row was drawn from, and whatever it returns sits on that same
> row, after `rowTrailing`'s content. It has to fit on one line, so give it icon buttons with an
> `aria-label` rather than text buttons. It is mounted when the leaf opens and unmounted when it
> closes.
>
> Every level of the tree starts its labels on one column, whether or not a row can expand, and
> a session with no title shows a shortened id with the full id in its tooltip.

## UPDATE · `apps/docs/docs/workforce/ui.md` · "Where each component reads from", the flow-list paragraph

> **The flow list.** The navigator reads your server's flow list, plus a session list for each
> leaf you open. A leaf is a row whose sessions you can open: a single-instance flow's row, or
> one copy of a flow that has many. Like the panels, it reads on mount and doesn't watch. The
> `leafToolbar` slot draws on an open leaf's own row and is handed a `refresh` function that
> re-reads that leaf's sessions, so a refresh button sits right next to the thing it refreshes.

## CREATE · `.changeset/flow-navigator-row-actions.md`

```md
---
"@flow-state-dev/react": minor
"@flow-state-dev/devtool": patch
---

`FlowNavigator` draws an open leaf's `leafToolbar` on the leaf's own row, after `rowTrailing`,
instead of on a line of its own above the sessions. The slot's name and arguments are
unchanged, but its content now has to fit on a row: replace text buttons with icon buttons that
carry an `aria-label`. Every tree level now starts its labels on one column, notes line up with
the level they describe, and a session with no title shows a shortened id with the full id as
its tooltip. The DevTool rail picks all of this up (FIX-1561).
```

## Publication ownership

This issue publishes all three after VG passes. The workforce UI page's styling section and
the README's other slot descriptions are unchanged and not redrafted here. The epic's shared
narrative about the navigator (FIX-1455) is untouched.
