---
"@flow-state-dev/fsdev": patch
---

The fullscreen conductor board writes the flow id and checkout on the main screen before it opens, so `/quit` leaves those names in the terminal scrollback. (LAB-151)
