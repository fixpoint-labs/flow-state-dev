---
"@flow-state-dev/shift-manager": patch
---

DevTeam's `openLab` and its `coder` worker flow take `stopsOnAbort`. With it on, a line typed into a running coding task stops the run and the same request continues its coding session with the line, using no attempt; off (the default), the line waits for the run's own end. Turn it on only for a harness whose abort waits for its process to exit (FIX-2293).
