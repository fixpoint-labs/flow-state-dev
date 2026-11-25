---
"@flow-state-dev/devtool": patch
---

In the dark theme, the dim layer behind a DevTools dialog is now a dark, see-through layer instead of a light tan one (FIX-2922). Every DevTools dialog paints its dim layer from one theme token, `--fs-scrim`; the light and draft themes look as before.

Docs: none (a visual fix; no API change)
