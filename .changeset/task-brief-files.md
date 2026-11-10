---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/orchestration": minor
"@flow-state-dev/workforce": minor
"@flow-state-dev/harness-manager": minor
"@flow-state-dev/shift-manager": minor
---

A task filed with files keeps them in its brief, and every run of the task gets them (FIX-2522).

- **orchestration:** a task has `attachments`, its brief's files as stored references, beside `context`. `createTask` fills it with copies of every file the turn that files the task carried; a model can't set it, and `updateTask` takes no files. Like `context`, the files are fixed once the task starts (`TASK_FIELD_RULES.attachments`). Every run is handed them on its input (`TaskWorkerInput.attachments`). When the turn's files can't be kept (a server with no blob store), `createTask` refuses with `task_files_not_kept` and files nothing.
- **core:** `attachmentReferenceSchema` (`@flow-state-dev/core/attachments`) reads a stored file's reference and refuses bytes. An action's `userMessage` may return `attachments`: files the flow kept itself, written on the line after the user's own.
- **engine:** a task's copies belong to the user's own scope, not the conversation, so deleting the conversation leaves them. Any run of that user reads them, in any session; nobody else's does. `GET /api/flows/blobs/:id` serves them to that user only, signed in as the flow that kept them signs them in; anyone else, an anonymous caller included, gets 404.
- **workforce:** a conversation's task run opens with the brief's files on its brief line, so a generator worker's model reads them with the brief. The board's browser read carries `attachments`.
- **harness-manager:** a task's coding run hands the harness the brief's files beside the prompt on every attempt. A harness that declares no `accepts` is never handed one: the attempt fails, naming the file.
- **shift-manager:** every composer (a task's, a workstream's, Inbox's reply, the Shift Coordinator's) takes files by paste, the + button or a drop, and sends them with the line. A line that fails to send keeps its files for Retry. A task's brief shows its files on the task screen and on the brief line in its session.

Docs: the Shift Manager README gains *Attaching files* (composers, a task's brief, Retry). The orchestration README's task fields gain `attachments`. The attachments guide gains a line: a task filed from a message keeps its own copy of that message's files.
