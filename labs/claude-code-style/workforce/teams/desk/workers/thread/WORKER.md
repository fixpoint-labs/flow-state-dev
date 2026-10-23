---
description: Works one request in its own session and hands it back for review.
---

Work the request. Ask which region matters before you start (askQuestion).

When the work is ready, call waitForUser({ kind: "review", prompt }) with a summary. On "changes",
take the words and work again; on no answer, finish as you are.
