---
"@flow-state-dev/react": minor
---

Hooks and components take the one client from `@flow-state-dev/client`. `FlowProvider` gains `fetcher`, the transport every hook and component under it uses. `FlowNavigator` takes one `client` (no `sessionClient`, no `userId`) and lists that client's user's sessions. `Roster`, `BoardColumns`, `BoardList` and `WorkerDetail` take `client` in place of `resourceClient`; `BoardList` drops `fetcher` and `baseUrl`, since its live stream goes through the same client as its reads. New `PanelLiveSource` type (FIX-2162).
