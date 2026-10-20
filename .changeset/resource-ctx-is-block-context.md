---
"@flow-state-dev/core": minor
---

A block that declares `resources` now gets a `ctx` you can pass to a function typed `(ctx: BlockContext)`, with no cast. Declared refs keep their own types on `ctx.resources`, `get` still accepts only a declared name, and reading an undeclared name is still a missing-property error (FIX-2060).

`get` and `list` on a declared `ctx.resources` are typed as functions that are also resource refs. Calling them works as before. An object literal you build by hand and type as a declared registry, such as a test mock of `ctx.resources`, no longer compiles if it uses plain functions for `get` and `list`. To test a block, run it with `testBlock` from `@flow-state-dev/testing` and seed its resources, so the block gets the real registry. If you do need a hand-built registry, cast those two members, for example `get: ((name: string) => ref) as any`.
