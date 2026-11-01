---
"@flow-state-dev/harness-manager": patch
---

`harnessSessionFlow({ approveTools: true })` makes a session turn's tool call that isn't pre-allowed wait for the user as an approval stop, then resumes the same conversation on Allow, Allow for this run (for the rest of the turn), or Deny, composing the manager's approval pieces (FIX-2432).
