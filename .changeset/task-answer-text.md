---
"@flow-state-dev/workforce": patch
---

`answerTextOf(output)` is exported from the root and from `./browser` (FIX-2561): a completed task's answer as text, read from its row's `output` by the rule the conversation lands it by. An agent worker's answer is the output itself, a string; a coding run's is the output's `answer`. A screen that read only `output.answer` showed no result for an agent worker's task.
