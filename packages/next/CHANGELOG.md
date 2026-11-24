# @flow-state-dev/next

## 0.1.7

### Patch Changes

- 44b199d: FIX-2805: Every host now refuses to serve an app that still trusts `body.userId`, on any `NODE_ENV`, including when it is unset. `serve()` throws before listening on a non-loopback host, and a flow registered after that still gets a 500. Lambda, Next, and Vercel do the same on each request. The 500 body is `Internal server error`; the flow kinds are logged once. A loopback bind (`127.0.0.1`, `localhost`) is unchanged. `allowUnauthenticated: true`, and `fsdev serve` / `fsdev dev --allow-unauthenticated`, is the override.

  A network `serve()` initializes stores before the port opens, so `/healthz` is not up during that cold start.

  Docs: packages/node/README.md (the quick start `await serve(flowState)` and `await serve(flowState, { pushSecret })` throw on the default host `0.0.0.0` unless every flow has a resolver or the call passes `host: "127.0.0.1"` or `allowUnauthenticated: true`; the network-bind section should say `serve()` runs the check itself, keeps checking after `register()`, and that Lambda, Next, and Vercel return a generic 500 with the kinds only in the log), apps/docs/docs/server/host-adapters.md (`await serve(flowstate, { basePath: "/flows" })` needs a resolver or a loopback host), apps/docs/docs/configuration/client.md (the `serve(flowstate, { basePath: "/flows" })` comment, same), apps/docs/guides/deployment.md (a hand-written `serve()` runs the same guard as `fsdev serve`), apps/docs/guides/realtime.md (`serve(flowstate, { pushSecret })` needs a resolver or `host: "127.0.0.1"`). `apps/docs/docs/workforce/overview.md` already sets `resolvePrincipal`, so that `serve(flowState, { port: 3000 })` sample keeps working.

- Updated dependencies [091a1dd]
- Updated dependencies [04812f3]
- Updated dependencies [61efa05]
- Updated dependencies [ec99b11]
- Updated dependencies [4b4a7d4]
- Updated dependencies [8e111c9]
- Updated dependencies [d30f516]
- Updated dependencies [a27cf26]
- Updated dependencies [77a6c9b]
- Updated dependencies [5e55476]
- Updated dependencies [81b1693]
- Updated dependencies [e3ca793]
- Updated dependencies [e505adf]
- Updated dependencies [5b2bd16]
- Updated dependencies [819c2a5]
- Updated dependencies [fe85f56]
- Updated dependencies [8dfcb2e]
- Updated dependencies [091078d]
- Updated dependencies [f89e8a5]
- Updated dependencies [4394069]
- Updated dependencies [44b199d]
- Updated dependencies [5549fd1]
- Updated dependencies [cf185b3]
- Updated dependencies [c7ce9ff]
- Updated dependencies [c487501]
- Updated dependencies [1600ca1]
- Updated dependencies [3973e1f]
- Updated dependencies [41dcd7e]
- Updated dependencies [ae56d59]
- Updated dependencies [e238e18]
- Updated dependencies [a63b662]
- Updated dependencies [c049036]
- Updated dependencies [74a7b9d]
- Updated dependencies [b43424c]
- Updated dependencies [182fb96]
- Updated dependencies [3ef3979]
- Updated dependencies [42980e4]
- Updated dependencies [f9daf5a]
- Updated dependencies [de09b77]
- Updated dependencies [2e7c92f]
- Updated dependencies [c82adfa]
- Updated dependencies [aa45e92]
- Updated dependencies [546603f]
- Updated dependencies [4a6643c]
- Updated dependencies [18adad9]
- Updated dependencies [246f0ba]
- Updated dependencies [4698256]
- Updated dependencies [85ca2a3]
- Updated dependencies [91184e2]
- Updated dependencies [95f3cce]
- Updated dependencies [0454257]
- Updated dependencies [81c145c]
- Updated dependencies [ec1fdf9]
- Updated dependencies [1970b12]
- Updated dependencies [c36ffa0]
- Updated dependencies [23bac7e]
- Updated dependencies [1f46aaf]
- Updated dependencies [b5b52b9]
- Updated dependencies [ee91375]
  - @flow-state-dev/engine@0.6.0

## 0.1.6

### Patch Changes

- Updated dependencies [531bf32]
- Updated dependencies [05a7022]
- Updated dependencies [4d3f49e]
- Updated dependencies [a1386ea]
- Updated dependencies [46e4297]
- Updated dependencies [d3eaa00]
- Updated dependencies [f1e6315]
- Updated dependencies [45c158b]
- Updated dependencies [bc65135]
- Updated dependencies [65ee4c5]
- Updated dependencies [da4a4bb]
- Updated dependencies [5f569fd]
- Updated dependencies [844a4f9]
  - @flow-state-dev/engine@0.5.0

## 0.1.5

### Patch Changes

- Updated dependencies [e0daf6e]
- Updated dependencies [b9e6dd0]
- Updated dependencies [9a355b2]
- Updated dependencies [7d92efe]
- Updated dependencies [387bee2]
- Updated dependencies [6c4a3b3]
  - @flow-state-dev/engine@0.4.0

## 0.1.4

### Patch Changes

- 7da156e: Organization ids are now validated as well-formed, non-blank Unicode everywhere (resolver, `runAction`, dispatch, BullMQ jobs, schedules, `fsdev run --org`) and seat addresses escape any such id, while route segments are decoded exactly once on every host (`parseFlowRoute` now takes decoded segments, built from a raw URL by the new `decodePathSegments`), so escaped seat ids resolve on Next and Vercel and stored rows or queued jobs with a lone-surrogate org id are now refused (FIX-1757).
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
