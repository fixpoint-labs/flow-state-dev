# @flow-state-dev/node

## 0.1.4

### Patch Changes

- 698e06b: New `apiPath` option on every client constructor and on `FlowProvider` names where the server mounts the flow API (default `/api/flows`), so the client and React hooks can reach a Node server started with a custom `basePath`. Requests go to `baseUrl` + `apiPath` + route; with `apiPath` unset, every URL is unchanged. The `@flow-state-dev/node` README documents pairing `basePath` with `apiPath` (FIX-1677).
- 7da156e: Organization ids are now validated as well-formed, non-blank Unicode everywhere (resolver, `runAction`, dispatch, BullMQ jobs, schedules, `fsdev run --org`) and seat addresses escape any such id, while route segments are decoded exactly once on every host (`parseFlowRoute` now takes decoded segments, built from a raw URL by the new `decodePathSegments`), so escaped seat ids resolve on Next and Vercel and stored rows or queued jobs with a lone-surrogate org id are now refused (FIX-1757).
- 7f892f6: `serve()` gains `pageMeta`, extra `<meta>` tags written into every HTML page served from `staticDir`, and `pageHandler`, a Connect-style handler for non-API GET requests tried before the SPA fallback; `createPageHtmlTransform` applies the same HTML writing to a page a handler renders itself; and `disposeOnClose: false` lets several servers share one runtime that the caller disposes once (FIX-1770).
- 83c48a7: `serve()` and `createPageHtmlTransform` gain `pageScript`, an inline script written into every HTML page after the `pageMeta` tags (FIX-1770).
- Updated dependencies [920adc3]
- Updated dependencies [283fb2a]
- Updated dependencies [cd6f7fb]
- Updated dependencies [0b57bc9]
- Updated dependencies [be1bddf]
- Updated dependencies [397cfa7]
- Updated dependencies [9f06d39]
- Updated dependencies [452b702]
- Updated dependencies [e4fb1f1]
- Updated dependencies [538cd1a]
- Updated dependencies [585b75b]
- Updated dependencies [3b5266a]
- Updated dependencies [b75c1ed]
- Updated dependencies [25ac53a]
- Updated dependencies [6453d2c]
- Updated dependencies [62133c4]
- Updated dependencies [f282bcb]
- Updated dependencies [55c62a6]
- Updated dependencies [85b2965]
- Updated dependencies [1355483]
- Updated dependencies [099906a]
- Updated dependencies [5902deb]
- Updated dependencies [211679a]
- Updated dependencies [5181ddb]
- Updated dependencies [7da156e]
- Updated dependencies [8a55e23]
- Updated dependencies [01b29f0]
- Updated dependencies [712dc22]
- Updated dependencies [afb512f]
- Updated dependencies [21ffcbb]
- Updated dependencies [5a55080]
- Updated dependencies [2d2518b]
- Updated dependencies [c57890d]
- Updated dependencies [7d4c413]
- Updated dependencies [27b198a]
- Updated dependencies [a64132b]
- Updated dependencies [0abbcd9]
- Updated dependencies [d9d00a4]
- Updated dependencies [c6b2db9]
- Updated dependencies [839e915]
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
- Updated dependencies [d9d00a4]
- Updated dependencies [229de7a]
- Updated dependencies [4ca0e99]
- Updated dependencies [83cd9c2]
- Updated dependencies [7c9e932]
- Updated dependencies [637b6d5]
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
- Updated dependencies [8f5277e]
- Updated dependencies [1f2dadd]
- Updated dependencies [cd180d7]
- Updated dependencies [2c43888]
- Updated dependencies [a26e426]
- Updated dependencies [69ba29c]
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
