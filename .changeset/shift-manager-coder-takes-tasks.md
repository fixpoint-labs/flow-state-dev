---
"@flow-state-dev/shift-manager": minor
---

The DevTeam's coder takes a conversation's task: ask your Shift Coordinator to have the coder look at a project's repository, and it files a task for `eng.coder` naming the project (`input.project`, `{ visibility, id }`). The coder works it in its own checkout of that project's repository (or on its files when it has none), and its answer lands in the conversation under its name. A task naming no project, or one you aren't a member of, fails at once saying why; a run that fails, or whose answer Jev judges as missing the goal, gets one more attempt and then fails with the reason. A question from the coder lands as a line, and your answer goes back into the same run. Feature work from the EM's board runs as before (FIX-1866).
