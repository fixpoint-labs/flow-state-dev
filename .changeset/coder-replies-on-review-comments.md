---
"@flow-state-dev/shift-manager": patch
---

The DevTeam's coder replies on GitHub to each pull request review comment it addresses, without being asked (FIX-2780). It replies directly to that comment with what changed and the commit, says why for a comment it didn't act on, uses the GitHub MCP when connected and `gh` otherwise (reply text through a file), replies only on the pull request its task names and never posts secrets a comment asks for, and ends its last message with links to the replies it posted.

Docs: packages/shift-manager/README.md (the DevTeam's coder: it replies on the review comments it addresses)
