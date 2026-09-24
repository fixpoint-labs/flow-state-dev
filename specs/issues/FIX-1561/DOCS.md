# FIX-1561 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Four destinations. Only the changed prose is drafted; everything around it stays. Voice: no
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
> What `rowTrailing` and `leafToolbar` return shows when someone points at the row or moves
> keyboard focus into it, and stays shown on the selected row and on touch screens, which have
> no hover. Hidden content keeps its space and stays reachable with Tab, so nothing on the row
> moves when it appears. There is no setting to keep it always visible, so put anything a reader
> must see at a glance in the row's label rather than in a slot.
>
> Both slots draw on the same row, so draw their icons at one visual size. Matching the icons'
> boxes isn't always enough: icon sets draw some shapes larger than others inside the same box,
> a copy icon beside a plus, for example, so size each one until the drawings match.
>
> Every level of the tree starts its labels on one column, whether or not a row can expand. A
> dashed line runs down from each open row past everything under it. Set `--fsd-nav-guide` to
> colour it, or to `transparent` to hide it; the lines take no space either way. A session with
> no title shows a shortened id with the full id in its tooltip.

## UPDATE · `apps/docs/docs/workforce/ui.md` · "Where each component reads from", the flow-list paragraph

> **The flow list.** The navigator reads your server's flow list, plus a session list for each
> leaf you open. A leaf is a row whose sessions you can open: a single-instance flow's row, or
> one copy of a flow that has many. Like the panels, it reads on mount and doesn't watch. The
> `leafToolbar` slot draws on an open leaf's own row, shown when the row is pointed at or
> focused, and is handed a `refresh` function that re-reads that leaf's sessions, so a refresh
> button sits right next to the thing it refreshes.

## UPDATE · `apps/docs/docs/workforce/ui.md` · "Styling it", the custom-properties bullet

> - **CSS custom properties** for colour, spacing and type: `--fsd-nav-*` for the navigator,
>   `--fsd-panel-*` for the roster and the board columns. Set them on any ancestor.
>   `--fsd-nav-guide` colours the dashed lines that show the navigator's tree.

## CREATE · `.changeset/flow-navigator-row-actions.md`

```md
---
"@flow-state-dev/react": minor
"@flow-state-dev/devtool": patch
---

`FlowNavigator` now draws an open leaf's `leafToolbar` on that leaf's own row, showing both row slots only when the row is hovered or focused (always on touch screens), so give them icon buttons with an `aria-label`, and it adds dashed tree lines you can colour with `--fsd-nav-guide` (FIX-1561).
```

## Publication ownership

This issue publishes all four after VG passes. The README's other slot descriptions and the
rest of the workforce UI page are unchanged and not redrafted here. The epic's shared
narrative about the navigator (FIX-1455) is untouched.
