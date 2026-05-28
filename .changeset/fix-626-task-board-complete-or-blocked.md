---
"@flow-state-dev/patterns": minor
---

Task Board now defaults to `onIdle: "complete-or-blocked"`, which exits the drain when the board is either fully drained or stuck — every remaining `pending` task has at least one non-`completed` dep, and no worker is in-flight. Closes the dispatcher-deadlock class of bug where a `pending` task whose upstream `errored` kept the loop spinning forever. The legacy `"complete"` mode is still available for boards that legitimately wait on an external pump to mark deps complete. The final `task-board-meta` item carries a new `terminationReason: "all-completed" | "blocked-by-failures"` field so callers can tell a clean drain from a dep-blocked exit without inspecting `counts`. Plan & Execute and Supervisor drop their identical `onIdle: "wait"` + `shouldExit` workarounds and inherit the new default.
