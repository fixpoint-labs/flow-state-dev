---
"@flow-state-dev/core": minor
"@flow-state-dev/chat-sdk": minor
"@flow-state-dev/scheduled": minor
"@flow-state-dev/engine": minor
---

Chat and scheduled inbound transports now carry the handler inline (the shared action-core model) instead of referencing a named action. `chat.on[*]` and `schedules` bindings replace `action: "name"` with `block: yourBlock`; event-addressed handlers no longer appear in `flow.actions` and are no longer exposed via HTTP/MCP. The chat adapter's `route`/`flowKind`/`action` mount options are removed — declare routing as `chat.on` subscriptions (use `when` predicates for content-based routing). `createResourceCollectionScheduleResolver` now takes a `blocks` map and persisted schedule rows store a `kind` discriminator instead of an `action` name. Dispatch resolution is namespaced under `metadata.chat` / `metadata.schedule`, matching `metadata.webhook`. Migrate by moving the handler block into the binding.
