---
---

Internal (process): corrects three stale facts in the always-loaded `CLAUDE.md`. No package surface changes.

The architecture doc count read 13 against 24 files on disk; the package-boundary constraint still named `server`, a package that no longer exists (the rule itself holds — `engine` depends on neither `client` nor `react`); and the best-practices heading read `BP-001…040` while BP-041 was already listed in its own body. Every agent loads this file on every task, so a stale line here is repeated into work that never reads the source it misdescribes (FIX-1213).
