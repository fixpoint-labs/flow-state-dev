---
"@flow-state-dev/fsdev": patch
---

Two fixes to the next-steps block (FIX-1159). The port a project's own dev server uses is now read from the dev URL with a real URL parser, so an IPv6 address like `http://[::1]:4210` no longer has the digits inside the address mistaken for its port — which had the block print `--port 4210` into a host already holding it. And `renderNextSteps` now refuses a dev script whose name starts with a dash: every package manager reads `npm run --help` as its own option and prints its help instead of running the script, and quoting the name does not change that.
