---
"@flow-state-dev/orchestration": patch
---

`createTask` files one task for one piece of work. Filing the same `goal` (ignoring case and spacing) for the same assignee while a task for it is still open is refused with `already_open`, naming the open task by its title, and nothing is filed. A follow-up, and a message handed on with `resultTo: "conversation"`, keep their own rules.
