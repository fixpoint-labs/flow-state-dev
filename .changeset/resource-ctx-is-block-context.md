---
"@flow-state-dev/core": minor
---

A block that declares `resources` now gets a `ctx` you can pass to a function typed `(ctx: BlockContext)`, with no cast. Declared refs keep their own types on `ctx.resources`, and `get` still accepts only a declared name (FIX-2060).

Two type changes on a block that declares resources:

- Reading an undeclared name such as `ctx.resources.typo` has type `never`, not a missing-property error. Using the value is still a type error, but the bare read compiles.
- `keyof typeof ctx.resources` is `string | number`, not the union of declared names.
