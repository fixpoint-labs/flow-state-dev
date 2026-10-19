---
"@flow-state-dev/core": patch
---

A block that declares `resources` now gets a `ctx` you can pass to a function typed `(ctx: BlockContext)`, with no cast. Declared refs keep their own types on `ctx.resources`, and `get` still accepts only a declared name. One visible change: on a block that declares resources, reading an undeclared name such as `ctx.resources.typo` now has type `never` instead of failing as a missing property, so any use of it is still a type error, but the bare read is not (FIX-2060).
