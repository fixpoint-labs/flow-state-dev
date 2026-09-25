---
"@flow-state-dev/workforce": minor
---

A channel `post` now leaves the line as one `channel-post` component item on the channel's session (`CHANNEL_POST_COMPONENT`), so a page can render the transcript from the session's items. New posts no longer land in `state.transcript`; `read` returns the lines already there first, then the posted ones inside the session's history window (50 requests by default). A message sent to an `agent` seat's `run` is now kept as the caller's turn in that seat's conversation (FIX-1585).
