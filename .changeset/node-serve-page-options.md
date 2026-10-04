---
"@flow-state-dev/node": patch
---

`serve()` gains `pageMeta`, extra `<meta>` tags written into every HTML page served from `staticDir`, and `pageHandler`, a Connect-style handler for non-API GET requests tried before the SPA fallback; `createPageHtmlTransform` applies the same HTML writing to a page a handler renders itself (FIX-1770).
