---
"@flow-state-dev/devtool": minor
---

The DevTool now uses the Flow State brand: Space Grotesk and IBM Plex Mono, square hairline surfaces, and three themes (Paper, Draft, Night) picked from a header switch and remembered per browser. Night is the default. The panel's colors are scoped to `.fsd-devtool-panel`, so an embedding host's own tokens are untouched. `FlowStateMark` now renders an inline SVG that follows the active theme; its `theme` prop is removed (FIX-1928).
