---
"@flow-state-dev/react": patch
---

`Roster` and `BoardColumns` now read every page of their collection, following the list route's cursor instead of stopping at the first page — a collection past the route's default page size no longer truncates silently, dropping its last rows (FIX-1477).
