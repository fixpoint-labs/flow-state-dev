---
"@flow-state-dev/node": patch
---

`serve()` and `createPageHtmlTransform` gain `pageScript`, an inline script written into every HTML page after the `pageMeta` tags (FIX-1770).
