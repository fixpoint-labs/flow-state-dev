---
"@flow-state-dev/orchestration": patch
---

A task cancelled while its run works on past its harness no longer leaves that run waiting for a person forever (FIX-2847). Before, a coding run whose task was cancelled during its judge stopped for its review anyway. No row mirrored that stop, and the cancel had found nothing to resume, so the run's request stayed `suspended`: a session's runs counted it as background work still running, and its review card could still be answered. Now the claim gate's check at the request's end cancels a stop for a person when the task has already ended, `taskCancelled`, as the task's own cancel would have. A stop on a row that a later attempt or turn claimed is left alone.
