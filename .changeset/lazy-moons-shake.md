---
"@flow-state-dev/workforce": patch
---

A workforce root spelled with a `..` that steps back through an earlier segment is now refused, wherever a reader opens a root (FIX-1375).

```
readWorkforceDirectory("/srv/app/current/../workforce")
// Workforce directory "…" is spelled with a ".." that steps back through an
// earlier segment — refused for safety … Pass the path it resolves to.
```

The root is checked for a symlink by asking the filesystem, which applies `..` only after walking what precedes it, while everything below the root is addressed with `path.join`, which applies it lexically. When the segment before the `..` is a symlink those two land in different directories, so the check answers for a tree that is never read and the content comes from somewhere else.

Roots built with `path.join` or `path.resolve` are already collapsed and are unaffected, as are ordinary relative roots like `../workforce` and `../../workforce` — nothing precedes a leading `..`, so nothing collapses. Only a hand-written root with an interior `..` changes behaviour, and the message names the path to pass instead.
