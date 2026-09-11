---
"@flow-state-dev/orchestration": patch
---

`readSkillsDirectory` now reports a `SKILL.md` that exists and cannot be read as a read failure, with the underlying reason, instead of reporting it as missing. A genuinely absent `SKILL.md` still reports missing (FIX-1356).
