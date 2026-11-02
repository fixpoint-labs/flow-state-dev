---
"@flow-state-dev/workforce": patch
"@flow-state-dev/shift-manager": patch
---

`listProjects` lists each project's `brief`, and its `forCoding` line no longer makes a coordinator ask which project when every project with a repository shares one: they reach the same code, so it files the task in the one that fits and says which. Shift Manager's coordinator reads "have Cursor (Codex, Claude) do it" as the coding agent its coder runs on, which each coder's description now names, and finds unknown names like "the super app" through the coder instead of asking (FIX-2487).
