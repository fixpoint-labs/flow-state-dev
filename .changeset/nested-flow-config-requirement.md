---
"@flow-state-dev/core": patch
---

A block whose `flowConfigSchema` asks for a setting inside a nested object can be installed on a flow again, and a block that declares a requirement from inside a dynamically resolved tool is now checked the same way a statically declared one is (FIX-1336).
