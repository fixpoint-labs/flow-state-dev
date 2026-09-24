---
"@flow-state-dev/react": minor
"@flow-state-dev/devtool": patch
---

`FlowNavigator` now draws an open leaf's `leafToolbar` on that leaf's own row, showing both row slots only when the row is hovered or focused (always on touch screens), so give them icon buttons with an `aria-label`, and it adds dashed tree lines you can colour with `--fsd-nav-guide` (FIX-1561).
