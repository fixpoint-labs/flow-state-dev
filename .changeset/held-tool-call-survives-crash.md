---
"@flow-state-dev/harness-manager": patch
---

A harness session's tool call held for approval now survives its host dying before the turn starts waiting (FIX-2445). When the interrupted turn is continued on another host, it waits on the same approval, and Allow lets the call through. Before, the continued turn ended as if the run had finished, and the call was never asked about.
