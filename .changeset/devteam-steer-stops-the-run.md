---
"@flow-state-dev/shift-manager": patch
---

DevTeam's `openLab` and its `coder` worker flow take `stopsOnAbort`. With it on, a line typed into a running coding task stops the run and the same request continues its coding session with the line, using no attempt; off, the line waits for the run's own end. Absent, the harness decides: Claude Code stops, the scripted stub doesn't (FIX-2293, FIX-2312).
