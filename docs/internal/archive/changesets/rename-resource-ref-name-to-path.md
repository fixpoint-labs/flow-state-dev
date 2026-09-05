---
"@flow-state-dev/core": minor
---

Rename `ResourceRef.name` to `ResourceRef.path` and add `ResourceRef.uri` returning `${scope}/${path}`. The field's value (the within-scope storage path, e.g. `"memos/p1/foo"`) is unchanged — only the public type field name. Update every access of `.name` on a `ResourceRef` to `.path`; replace any hand-built `${scope}/${name}` string with `ref.uri`. Hard cutover with no deprecation alias.
