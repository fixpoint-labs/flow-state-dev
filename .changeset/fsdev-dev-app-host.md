---
"@flow-state-dev/fsdev": patch
---

`fsdev dev` gains `--app <package|dir>`, which serves an app's built pages at the root of the port beside the flow API and moves the DevTool to a port of its own, handing each page its address as the `fsdev-devtool-url` meta; and `--host` with `--allow-unauthenticated`, where a non-loopback host runs `fsdev serve`'s authentication check, refuses a config that hands its page a bearer token, and keeps the debug surface closed. `--port` now refuses a value that isn't a whole number, and `executeDevCommand` resolves with a handle to close the server (FIX-1770).
