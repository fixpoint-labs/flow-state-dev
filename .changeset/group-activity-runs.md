---
"@flow-state-dev/react": minor
---

`ItemsRenderer`'s `toolGroupRenderer` groups `reasoning` items with `tool_output` items: a run of an agent's tool calls and thinking between its messages is one `group` segment. A group's `items` are `ActivityItem[]` (exported). `buildItemRenderStream` does that when `groupToolCalls` is `"activity"`. `true` still groups tool calls only, so a thought still splits a run of calls. A renderer that assumed every item in an activity group is a `tool_output` must handle `reasoning`.

`ItemsRenderer` also takes `live`: while the stream is open, the `toolGroupRenderer` receives `live` on the trailing group (the work no message has yet ended), so it can show the latest step instead of a summary.
