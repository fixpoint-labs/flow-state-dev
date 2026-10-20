---
"@flow-state-dev/core": minor
---

A block that declares `resources` now gets a `ctx` you can pass to a function typed `(ctx: BlockContext)`, with no cast. Declared refs keep their own types on `ctx.resources`, `get` still accepts only a declared name, and reading an undeclared name is still a missing-property error (FIX-2060).

One type change on `ctx.resources`: `get` and `list` are now also typed as a resource ref, the way the open registry on a plain `BlockContext` already types every key. Calling them is unchanged.
