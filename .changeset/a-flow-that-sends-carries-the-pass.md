---
"@flow-state-dev/workforce": patch
---

`hireWorkforce` refuses a worker flow whose model is offered `sendMessage` but that carries no session-board `dispatch` pass, since a message it sent whose first delivery failed would never be sent again. Spread the session kit's `entries(turn)` into `internal.actions` and declare the `manager` role. The Error Reporter's flow now carries the pass, so its messages are sent again until they land, and declares `manager` itself (FIX-2271).
