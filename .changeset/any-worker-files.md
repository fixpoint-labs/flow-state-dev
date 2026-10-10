---
"@flow-state-dev/workforce": minor
---

Any worker files tasks for its delegates that take one, not only a coordinator: `delegates:` joins the worker contract (`workerConfigSchema()`), so a worker flow that hand-declares the contract must accept it too, the built-in `agent` flow carries the task tools, the `addTask_tasks`-style actions and the four delegate actions, an app's own worker flow carries them with `defineSessionBoard({ installation, flowKind })`, and a worker none of whose delegates takes a task, a coordinator included, gets no task tools and its actions answer `no_delegation_board` (FIX-1802).
