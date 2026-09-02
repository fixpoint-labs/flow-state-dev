---
---

Internal (FIX-1298): the plugin test suite's "writes nothing" snapshot no longer walks `.git/`, so git's background maintenance can't race the check. Test-only; `@flow-state-dev/plugin` is private and nothing published changes.
