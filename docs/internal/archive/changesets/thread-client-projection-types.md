---
"@flow-state-dev/core": minor
"@flow-state-dev/react": minor
"@flow-state-dev/client": minor
---

Thread a resource/collection's client-projection output type end-to-end. `defineResource` and `defineResourceCollection` now carry the projected client-data shape (derived from `expose`, `exclude`, `data`, or the identity default), extractable with the new `ClientDataOf<typeof def>` helper. The resource React hooks (`useResource`, `useResourceCollection`, `useResourceCollectionList`, `useResourceCollectionItem`) take a `TClient` type parameter that types `clientData` instead of `unknown`, so apps can drop hand-mirrored client types and per-read casts. Type-level only — runtime behavior and the `JsonValue` wire payload are unchanged, and the hook parameter defaults to `unknown` so existing call sites are unaffected.
