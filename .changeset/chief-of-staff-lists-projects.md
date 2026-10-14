---
"@flow-state-dev/workforce": patch
"@flow-state-dev/shift-manager": patch
---

`defineProjectBlocks()` adds `listProjects`: the projects the caller is a member of, each with its address, title and repository. A shared project the caller isn't a member of is left out. The DevTeam Shift Coordinator has it as a tool, with a `forCoding` line saying what a coder's task that names no project does next, so asked to have the coder look at "our repo" it files the task for the one project with a repository without asking, and with two or more asks which one, naming them (FIX-1869).
