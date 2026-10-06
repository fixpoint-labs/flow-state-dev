---
"@flow-state-dev/fsdev": patch
---

`fsdev dev` gains `--watch`: the server restarts on the same port when a file the config loaded, or a file in the config's folder, is saved, and the pages open on it reload by themselves; a failed restart waits for the next save, and it binds loopback only. With `--app`, a package that also exports `getSourceRoot()` is served from that folder through the Vite its own install resolves, falling back to its built pages (FIX-1770).
