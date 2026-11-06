---
---

FIX-2456: the registry `Conversation` scrolls by `useJumpToLatest`. Make the feed with `useJumpToLatest({ resetKey: sessionId })`, pass it as `<Conversation feed={feed}>`, and call `feed.sent()` as the user's line goes out: the line rises to near the top and its reply streams below it. A Conversation that never sends takes `resetKey` alone. `ConversationScrollButton` takes an optional `feed`, is named *Jump to latest*, and takes no height. `ScrollOnNewRequest` and `useConversationScroll` are removed with no alias; use the feed. The registry composer's Enter now goes through `isSendKey`, so the Enter that confirms a Japanese or Chinese word on Safari no longer sends. The registry is private, so this fragment releases nothing and carries the docs intent only.

Docs: apps/docs/docs/ui/common-components.md (Conversation: the feed, `sent()`, the button, no `ScrollOnNewRequest`); apps/docs/docs/api/react.md and packages/react/README.md (the `useJumpToLatest` example uses the registry's `ConversationScrollButton feed={feed}` in place of a hand-written button)
