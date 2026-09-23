---
"@flow-state-dev/workforce": patch
---

A seat hired through `createSeatHireCapability` now records the organization that hired it, so a copy of its roster row read under another organization is refused on reload instead of becoming that organization's seat. Rows written before this change still reload in the organization they are stored under (FIX-1542).
