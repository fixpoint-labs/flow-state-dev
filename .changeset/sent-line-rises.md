---
"@flow-state-dev/react": minor
"@flow-state-dev/devtool": patch
"@flow-state-dev/shift-manager": patch
---

`useJumpToLatest` brings the person's line to near the top of the feed when they send, and never scrolls for content that arrives after it. Mark each of their lines with `{...feed.mine(line.id)}` and call `sent()` on send; without them the view stays where the reader put it and `atEnd` turns `false` when there is more below. DevTool's stream view and Shift Manager's conversation and task session scroll this way (FIX-2360).
