---
"@flow-state-dev/react": minor
---

`ItemsRenderer`'s `toolGroupRenderer` and `buildItemRenderStream`'s `groupToolCalls` now group `reasoning` items with `tool_output` items: a run of an agent's tool calls and thinking between its messages is one `group` segment, and a thought no longer splits a run of calls in two. A group's `items` are `ActivityItem[]` (exported); a renderer that assumed every item in a group is a `tool_output` must handle `reasoning`.

`ItemsRenderer` also takes `live`: while the stream is open, the `toolGroupRenderer` receives `live` on the trailing group (the work no message has yet ended), so it can show the latest step instead of a summary.
