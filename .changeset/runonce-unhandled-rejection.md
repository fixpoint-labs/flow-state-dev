---
"@flow-state-dev/engine": patch
---

`ctx.runOnce(key, fn)` no longer raises an unhandled promise rejection when `fn` rejects. The error still reaches the caller unchanged; nothing else is left unhandled, so a Node host running with the default `--unhandled-rejections=throw` no longer crashes when the caller catches it (FIX-1738).
