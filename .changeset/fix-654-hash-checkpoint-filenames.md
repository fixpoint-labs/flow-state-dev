---
"@flow-state-dev/server": patch
---

Filesystem checkpoint store now derives on-disk filenames from a truncated SHA-256 digest of the `blockInstanceId`, so deeply-nested compositions (such as pattern-skill activations) no longer fail to persist with `ENAMETOOLONG`. The canonical `blockInstanceId` is preserved inside the JSON body, so logs and operator inspection are unaffected.
