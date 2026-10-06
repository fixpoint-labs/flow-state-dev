# FIX-1770 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| FIX-1662 D1 *Locks in*: Shift Manager (then App Lab) "ships as a static app plus the shipped Node host, so it runs where `fsdev dev` runs". Source [`../FIX-1662/DECISIONS.md#d1`](../FIX-1662/DECISIONS.md#d1) | **Retained.** Still a static app over `serve()`; the host is now reached through fsdev's app hook | `start.mts` already called `serve()` with `staticDir`, the way `fsdev dev` serves the DevTool | [D1](DECISIONS.md#d1) | The Lab's config is still loaded as is |
| FIX-1662 PLAN S1: "New private package … plus a start script that loads a Lab's config … and hands it to `serve(flowstate, { staticDir })`". Source [`../FIX-1662/PLAN.md#surfaces`](../FIX-1662/PLAN.md#surfaces) | **Superseded.** The package is published and the start script is removed | Jake chose to publish (FIX-1770). The script's generic half belongs to fsdev | [D1](DECISIONS.md#d1), [D2](DECISIONS.md#d2), PLAN S7–S9 | `start --team devteam` becomes `start`; `--config` and `--assets` keep working; `--team`, `--devtool` and `--devtool-assets` are refused as unknown |
| FIX-1664 BR-23: the trace link "opens the devtool App Lab was started with". Source [`../FIX-1664/BUSINESS-RULES.md`](../FIX-1664/BUSINESS-RULES.md) | **Amended.** Only the DevTool served beside the app; no external DevTool by flag | A DevTool in another process can't read an in-memory Lab's runs, which is why Shift Manager started serving its own | BR-9, BR-10 | Callers of `--devtool <url>` get an unknown-flag refusal |
| FIX-1649 epic, *Decided in review*: "App Lab lives at `labs/app-lab/`, with the repo's dogfooded apps". Source [`../../epics/FIX-1649/DECISIONS.md#decided-in-review-recorded-so-no-child-reopens-them`](../../epics/FIX-1649/DECISIONS.md#decided-in-review-recorded-so-no-child-reopens-them) | **Superseded in part.** Moves to `packages/shift-manager`. The same bullet list's "the design-system package is private" is retained | Every publish guard and the packed-install check read `packages/` only | DECISIONS → *Decided, not asked* | Paths under `goals/` move with it (PLAN S10) |
| FIX-1649 D3: "One app that opens any Lab"; *Locks in* "the chrome stays inside `labs/app-lab`". Source [`../../epics/FIX-1649/DECISIONS.md#d3`](../../epics/FIX-1649/DECISIONS.md#d3) | **Retained**, extended to Labs outside this repository; the chrome stays inside the Shift Manager package at its new path | Nothing about a Lab changes; only where the app installs from | [D2](DECISIONS.md#d2) | No Lab writes UI, as before |

No predecessor is wholly superseded. Compare these intents with current code before building:
`start.mts` on `main` has since gained a stale-build rebuild, which PLAN S10 moves to the
checkout's `start` script.
