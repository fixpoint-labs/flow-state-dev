---
"@flow-state-dev/engine": minor
---

Rename the in-memory and filesystem org-store factories to `createInMemoryOrgStore` and `createFilesystemOrgStore`. The types they implement have been `OrgStore` since the project→org rename; the old `*ProjectStore` names are gone.
