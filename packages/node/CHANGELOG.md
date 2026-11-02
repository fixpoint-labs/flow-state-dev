# @flow-state-dev/node

## 0.2.1

### Patch Changes

- Updated dependencies [9a355b2]
- Updated dependencies [387bee2]
  - @flow-state-dev/engine@0.3.1

## 0.2.0

### Minor Changes

- 2ce15c7: Wakes: a debt's due time the engine keeps, one per session and internal entry (FIX-2078). The durability sweeper fires each due wake's entry in its session, as the session's owner, and re-arms on the earliest one; a pass in that session moves or clears it. `StoreRegistry.wakes` (`WakeStore`) is optional: the in-memory, filesystem, SQLite and Postgres stores keep wakes, and a custom store without them still loads, with debts paid on their fast paths only (the host says so once at start). `createFlowState({ maxDebtAgeMs })` sets how long a debt may stay outstanding past its due time, 24 hours by default. A host's shutdown waits for the requests its wakes started, up to `createFlowApiRouter({ shutdownDrainMs })` (10 s by default; `disposeFlowApiRouter(router, { drainMs })` per call), then aborts the rest and logs how many: each wake stays, and the next host fires it again. `@flow-state-dev/node`'s `serve()` passes what is left of its shutdown grace, through the server app's `dispose({ drainMs })`. At start the host reads its wake store once: one it can't read (a database upgraded without the migration that adds the wakes table) is treated as keeping none, with a one-time warning. **A Postgres or SQLite host that runs its migrations itself (`skipSchemaInit`) reruns them after upgrading**, or its wakes stay off. Custom store adapters can check theirs with `createWakeStoreConformanceTests` from `@flow-state-dev/engine/testing`.

### Patch Changes

- 698e06b: New `apiPath` option on every client constructor and on `FlowProvider` names where the server mounts the flow API (default `/api/flows`), so the client and React hooks can reach a Node server started with a custom `basePath`. Requests go to `baseUrl` + `apiPath` + route; with `apiPath` unset, every URL is unchanged. The `@flow-state-dev/node` README documents pairing `basePath` with `apiPath` (FIX-1677).
- 7da156e: Organization ids are now validated as well-formed, non-blank Unicode everywhere (resolver, `runAction`, dispatch, BullMQ jobs, schedules, `fsdev run --org`) and seat addresses escape any such id, while route segments are decoded exactly once on every host (`parseFlowRoute` now takes decoded segments, built from a raw URL by the new `decodePathSegments`), so escaped seat ids resolve on Next and Vercel and stored rows or queued jobs with a lone-surrogate org id are now refused (FIX-1757).
- 7f892f6: `serve()` gains `pageMeta`, extra `<meta>` tags written into every HTML page served from `staticDir`, and `pageHandler`, a Connect-style handler for non-API GET requests tried before the SPA fallback; `createPageHtmlTransform` applies the same HTML writing to a page a handler renders itself; and `disposeOnClose: false` lets several servers share one runtime that the caller disposes once (FIX-1770).
- 83c48a7: `serve()` and `createPageHtmlTransform` gain `pageScript`, an inline script written into every HTML page after the `pageMeta` tags (FIX-1770).
- Updated dependencies [92b2b70]
- Updated dependencies [5d31955]
- Updated dependencies [15f7c6b]
- Updated dependencies [24afa6e]
- Updated dependencies [f8df86f]
- Updated dependencies [e2c190e]
- Updated dependencies [8e67ce5]
- Updated dependencies [920adc3]
- Updated dependencies [283fb2a]
- Updated dependencies [3221d05]
- Updated dependencies [f97b0ed]
- Updated dependencies [397cfa7]
- Updated dependencies [9f06d39]
- Updated dependencies [452b702]
- Updated dependencies [e4fb1f1]
- Updated dependencies [538cd1a]
- Updated dependencies [585b75b]
- Updated dependencies [3b5266a]
- Updated dependencies [2ffc03c]
- Updated dependencies [b75c1ed]
- Updated dependencies [25ac53a]
- Updated dependencies [6453d2c]
- Updated dependencies [62133c4]
- Updated dependencies [f282bcb]
- Updated dependencies [651c87e]
- Updated dependencies [d5ce1e0]
- Updated dependencies [55c62a6]
- Updated dependencies [85b2965]
- Updated dependencies [1355483]
- Updated dependencies [6819520]
- Updated dependencies [099906a]
- Updated dependencies [ad5df6f]
- Updated dependencies [5902deb]
- Updated dependencies [2ce15c7]
- Updated dependencies [4f2e13e]
- Updated dependencies [211679a]
- Updated dependencies [5181ddb]
- Updated dependencies [60d1bf4]
- Updated dependencies [42bfbe6]
- Updated dependencies [fe5df7d]
- Updated dependencies [57323b9]
- Updated dependencies [7da156e]
- Updated dependencies [8a55e23]
- Updated dependencies [01b29f0]
- Updated dependencies [712dc22]
- Updated dependencies [afb512f]
- Updated dependencies [430db1b]
- Updated dependencies [21ffcbb]
- Updated dependencies [f9995b1]
- Updated dependencies [5a55080]
- Updated dependencies [3a6c910]
- Updated dependencies [2d2518b]
- Updated dependencies [c57890d]
- Updated dependencies [3cbab3a]
- Updated dependencies [028af6f]
- Updated dependencies [a965a50]
- Updated dependencies [41638f3]
- Updated dependencies [7d4c413]
- Updated dependencies [27b198a]
- Updated dependencies [a64132b]
- Updated dependencies [0abbcd9]
- Updated dependencies [d9d00a4]
- Updated dependencies [c6b2db9]
- Updated dependencies [839e915]
- Updated dependencies [711ed0e]
- Updated dependencies [72c5b17]
- Updated dependencies [02ee032]
- Updated dependencies [65ddb90]
- Updated dependencies [47a02d0]
- Updated dependencies [e0f10e2]
- Updated dependencies [9083569]
- Updated dependencies [9510a03]
- Updated dependencies [0935a47]
- Updated dependencies [d2f77fc]
- Updated dependencies [0995afe]
- Updated dependencies [adbcf0b]
- Updated dependencies [d9d00a4]
- Updated dependencies [1cfd80c]
- Updated dependencies [229de7a]
- Updated dependencies [4ca0e99]
- Updated dependencies [3b0161c]
- Updated dependencies [d86c7db]
- Updated dependencies [fa7b22e]
- Updated dependencies [a4e626b]
- Updated dependencies [83cd9c2]
- Updated dependencies [7c9e932]
- Updated dependencies [637b6d5]
- Updated dependencies [60c8192]
- Updated dependencies [0503c38]
- Updated dependencies [8195995]
- Updated dependencies [71b0174]
- Updated dependencies [8b8ba8d]
- Updated dependencies [97894aa]
- Updated dependencies [3c2ab06]
- Updated dependencies [334c1e3]
- Updated dependencies [64b3ed7]
- Updated dependencies [92a8b49]
- Updated dependencies [9ed6b29]
- Updated dependencies [9f32967]
- Updated dependencies [b7c523b]
- Updated dependencies [6bf61dc]
- Updated dependencies [b552b50]
- Updated dependencies [c8c8b38]
- Updated dependencies [1f2dadd]
- Updated dependencies [cd180d7]
- Updated dependencies [6306a75]
- Updated dependencies [e11764a]
- Updated dependencies [2c43888]
- Updated dependencies [9af8ce5]
- Updated dependencies [6e1a819]
- Updated dependencies [0d6278e]
- Updated dependencies [a26e426]
- Updated dependencies [69ba29c]
- Updated dependencies [d97031f]
- Updated dependencies [f741004]
- Updated dependencies [49d2aca]
- Updated dependencies [3c10d9d]
- Updated dependencies [ce8f765]
- Updated dependencies [96ff077]
  - @flow-state-dev/engine@0.3.0

## 0.1.3

### Patch Changes

- Updated dependencies [795b550]
- Updated dependencies [6b8bfe4]
- Updated dependencies [3e43c96]
- Updated dependencies [b48158a]
- Updated dependencies [e4c443e]
- Updated dependencies [e4b6576]
  - @flow-state-dev/engine@0.2.0

## 0.1.2

### Patch Changes

- b56e7d1: Every package can be imported again: 0.1.1 shipped JavaScript whose relative imports were missing the file extensions Node's ESM resolver requires, so importing any 0.1.1 package failed with `ERR_MODULE_NOT_FOUND` (FIX-1431).
- Updated dependencies [b56e7d1]
  - @flow-state-dev/engine@0.1.2

## 0.1.1

### Patch Changes

- @flow-state-dev/engine@0.1.1

## 0.1.0

### Minor Changes

- b3e6e22: Initial release (FIX-1187).

### Patch Changes

- Updated dependencies [67b4157]
- Updated dependencies [527c5ca]
- Updated dependencies [e2fda9d]
- Updated dependencies [4e562d0]
- Updated dependencies [afcac3d]
- Updated dependencies [b3e6e22]
- Updated dependencies [ce85e80]
- Updated dependencies [af40427]
- Updated dependencies [5fa52aa]
- Updated dependencies [4054c64]
- Updated dependencies [fda9b15]
  - @flow-state-dev/engine@0.1.0
