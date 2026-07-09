---
"@flow-state-dev/devtool": patch
---

DevTool: `continuation` and `suspension_resume` items are no longer dropped by the stream view's `STREAM_TYPES` filter — both now render as a compact boundary-marker row (matching the existing resume-marker visual pattern) instead of being silently discarded. The Trace tab's tree (`buildTraceTree`) now reads from the request's raw, uncollapsed item log so retained partial rows survive, and renders a dedicated divider row for the boundary, positioned by `itemIndex` so prior-log items (including retained background/partial rows) render above it and the live re-run renders below — without disturbing the existing "BG" sidechain badge on either side. Because a continuation re-runs the same request (and block instance ids are deterministic per request/path), a block with rows on both sides of the boundary renders as one row per side rather than merging into its pre-crash row — merging would pin the divider to the bottom of the tree.
