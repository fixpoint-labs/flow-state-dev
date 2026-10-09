---
"@flow-state-dev/workforce": minor
---

A coordinator conversation keeps a task board of its own (FIX-1794). Its turn carries Orchestration's eight task tools, and the conversation's session takes them as actions (`addTask_tasks`, `listTasks_tasks` and the rest); an assignee must be one of the conversation's delegates whose flow takes tasks. A filed task starts by itself in a new task session of the delegate's, a child of the conversation, and the conversation hears once, under the delegate's name, when it completes, fails for good or stops on a question. `findWorkerSession` and `ensureWorkerSession` take a `taskId` criterion beside `filingSessionId`, and `ensureWorkerSession` never creates a task's session; a session create whose `state` carries `taskId` is refused with a 400. Every worker on the built-in `agent` flow takes tasks from a conversation's board, and so does a coordinator worker; a task session's own `addTask` is refused.
