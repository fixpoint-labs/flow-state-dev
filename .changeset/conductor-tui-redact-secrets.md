---
"@flow-state-dev/fsdev": patch
---

`fsdev conductor` redacts git and `gh` tokens in the transcript so a `git remote -v` cannot paint a host credential. (LAB-151)
