---
"@flow-state-dev/engine": patch
---

A client's resource write no longer makes every open session list read again (FIX-2864). The write runs in a session no listing shows, so its writes no longer publish a `run` notice on the user's topic. `useSessionList` and `FlowNavigator` read again only for a change a list can show: a session made, titled or deleted, or a request in one starting or ending.
