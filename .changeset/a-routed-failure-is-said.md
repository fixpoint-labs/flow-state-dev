---
"@flow-state-dev/workforce": patch
---

When a coordinator's routing (best fit, round robin or everyone) hands a message to a delegate and that delegate's task fails, the conversation now gets one line under the delegate's name: `<delegate> couldn't answer: <the error>`. It wakes no turn. A cancelled task or an empty reply still says nothing (FIX-2266).
