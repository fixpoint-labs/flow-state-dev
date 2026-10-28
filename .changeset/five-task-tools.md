---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/workforce": minor
"@flow-state-dev/devtool": patch
---

The task tools are now five: the filer's `createTask`, `getTask`, `listTasks` and `updateTask`, and the worker's `reportProgress` (FIX-2081). `addTask`, `assignTask`, `completeTask`, `failTask`, `cancelTask` and `readTask` are removed, as tools and as `<tool>_<board>` actions; no tool finishes a task. `updateTask({ id, ...fields })` takes flat fields with one rule each: `goal`, `title`, `context`, `input`, `deps`, `priority`, `labels`, `metadata`, `assignee`, `maxAttempts`, a hold and a release change only before a task first starts, and `status: "cancelled"` lands until it finishes. A refusal names the fields and the state (`field_locked_after_start`, `task_finished`). `reportProgress({ statusNote?, output? })` writes a status note and a checkpoint on the task its turn holds; `createReportProgress` builds it, and a checkpoint stays the task's output when the task completes. A task filed from a task turn carries `filedByTask`, and `listTasks` filters on it.

In Workforce, a worker gives work only to its delegates, in a task session too: a piece for any other worker is refused with `unknown_assignee`. `delegates: all` delegates to the whole roster, read on each call. A coordinator's own turn has `addDelegate`, `removeDelegate` and `setFallback` only when its file sets `editsOwnDelegates: true`; every worker with a board has `listDelegates`. The DevTool's task row actions follow the new tools.
