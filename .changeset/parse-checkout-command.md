---
"@flow-state-dev/workspace": patch
---

`@flow-state-dev/workspace` exports `parseCheckoutCommand(command)`, which checks and splits a command in one call: `{ words }` with the program first, or `{ problem }` with the same sentence `checkoutCommandProblem` gives. Use it where a setting becomes a command to run, such as a host's setup command (FIX-2387).
