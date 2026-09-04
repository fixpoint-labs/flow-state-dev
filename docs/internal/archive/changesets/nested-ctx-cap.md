---
"@flow-state-dev/core": patch
---

`ctx.cap` is now built for every block, not only the root action block. A block that declared `uses: [cap]` on a nested handler, sequencer/router step, or tool previously saw an empty `ctx.cap` — the accessors were only constructed by the server's `executeBlock`, which wraps the root block, while nested blocks run through core's block-run path. Core now builds each block's `ctx.cap.<name>` accessors from its own resolved capabilities as it runs, additively and skip-by-name: an accessor an ancestor already built is inherited untouched, and a block only constructs the capabilities it adds. A block reaches the capabilities it asked for regardless of nesting depth, matching how `uses`-declared resources already resolve.
