---
"@flow-state-dev/fsdev": patch
---

Two fixes to the next-steps block (FIX-1159). A project whose dev server runs on an IPv6 address no longer has the digits inside the address mistaken for its port, which had the block print a port the host already held. And a dev script whose name starts with a dash — `--help`, say — now renders with the end-of-options separator, so the printed command runs the script instead of the package manager's own help.
