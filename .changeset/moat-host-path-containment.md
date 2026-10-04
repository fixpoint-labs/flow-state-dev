---
"@flow-state-dev/tools": patch
---

The MOAT bash sandbox now keeps file reads and writes inside the workspace bind mount. A path under the mount whose `..` segments climb out of it is now rejected, and a symlink in the mount that points outside it is resolved inside the container rather than followed on the host (FIX-1708).
