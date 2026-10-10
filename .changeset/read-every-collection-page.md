---
"@flow-state-dev/client": minor
"@flow-state-dev/react": patch
---

`@flow-state-dev/client` exports `readEveryCollectionPage`, which reads every page of a collection with a single page ceiling (`COLLECTION_READ_MAX_PAGES`) and stops with `CollectionReadStoppedError` when the server repeats a cursor. The workforce panels in `@flow-state-dev/react` now read through it, so a server that repeats its cursor ends the panel's read after two pages with an error instead of after 1,000 (FIX-1674).
