---
"@flow-state-dev/client": patch
---

`sessionFeed` can reach a long session's older history. Its snapshot carries `hasEarlier`, true while the session holds items before the first one shown, and `feed.loadEarlier()` adds the page before them, with no gap or duplicate, while live items keep arriving. Draw a *Load earlier* button from it (FIX-2505).
