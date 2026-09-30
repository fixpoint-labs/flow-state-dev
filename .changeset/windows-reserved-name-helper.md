---
"@flow-state-dev/contracts": patch
"@flow-state-dev/core": patch
---

New `isWindowsReservedName(name)` helper on `@flow-state-dev/contracts/helpers`, re-exported from `@flow-state-dev/core/helpers`: `true` for the names Windows reserves for devices (`con`, `prn`, `aux`, `nul`, `com1`–`com9`, `lpt1`–`lpt9`) in any letter case. The filesystem store and the workforce tree loader now both read this one list; which names they refuse, and the messages they give, are unchanged (FIX-1428).
