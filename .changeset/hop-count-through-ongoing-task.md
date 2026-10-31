---
"@flow-state-dev/workforce": patch
---

A worker message sent from a task now counts on in the chain of the turn that filed the task, including a task filed `session: "ongoing"`, which runs in the delegate's existing session (FIX-2106). Before, a message from such a task started a new count, so a chain could get past `messages.budget` by passing through one. The filing writes its count on the row, under the `filedAtHop` metadata key, which a caller can't set or change. If you write in the filing conversation before the task starts, your line still starts a new count for it. A row filed before this change runs at its session's count, as it did.
