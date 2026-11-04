---
"@flow-state-dev/react": minor
"@flow-state-dev/devtool": patch
"@flow-state-dev/shift-manager": patch
---

`useJumpToLatest`'s `sent()` no longer goes to the end. The person's line, marked with the new `mine(key)`, rises to near the top of the feed when it lands, and the hook keeps room at the feed's end (as bottom padding) so a short reply leaves it there. Any scroll by the person cancels a rise that hasn't happened; `atEnd` and `jump()` look at content only. Mark each of the person's lines with `{...feed.mine(line.id)}`: a `sent()` with no marked line moves nothing. DevTool's stream view and Shift Manager's conversation and task session scroll this way (FIX-2360).
