---
"@flow-state-dev/fsdev": patch
---

`fsdev dev --app` also takes the path of a package's module file, so a command that wraps `fsdev dev` can name itself as the app from any working directory. `locateConfig` is exported, for such a command to find the config the way `fsdev dev` does. Under `--watch`, a restart no longer waits on runs still going in the old process: it exits after at most 3 seconds (FIX-1770).
