---
"@flow-state-dev/harness-manager": minor
---

On a workspace host with a held-work store, the manager now holds a run's repository work at the end of each turn, when it parks, and when the harness fails, and brings it back on another machine. The run record gains `place` (`{ host, state }`) and `held` (the last hold, or why it failed); both stay `null` with holding off. A run whose held work does not match its record, or lands on a host with holding off, is parked for its owner with a question naming what disagreed (`HarnessRunParked`), instead of starting over. A run is not completed on work it could not hold (FIX-1766).
