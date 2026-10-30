---
"@flow-state-dev/harness-manager": minor
---

New: `harnessSessionFlow`, a coding harness as one long-lived session a person talks to. Each turn continues the conversation the harness last confirmed, a session is created with the model it runs, a `steer` action hands a line to the running turn, and each turn is recorded in `harnessSessionStateSchema`. The host says where sessions work (`workspace`) and builds the harness block from the feeds (`agent`). Also new: `harnessStub`, a scripted harness for the slot, for checks that run no model (FIX-2320).
