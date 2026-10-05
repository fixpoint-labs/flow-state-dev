---
"@flow-state-dev/fsdev": patch
---

`fsdev dev --app` also takes the path of a package's module file, `locateConfig` is exported so a wrapping command finds the config the way `fsdev dev` does, and a `--watch` restart exits after at most 3 seconds instead of waiting on runs still going (FIX-1770).
