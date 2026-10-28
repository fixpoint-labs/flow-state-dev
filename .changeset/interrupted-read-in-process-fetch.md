---
"@flow-state-dev/engine": minor
"@flow-state-dev/core": minor
---

New `GET /api/flows/users/:userId/interrupted-requests` lists a user's interrupted requests every time it is called, including ones a sweep marked before the call; `check-interrupted` still sweeps and answers only what that call marked. Both lists now name each request's `flowId` (falling back to `flowKind` for older records). `RequestStatusSnapshot` gains `sessionId`, and the status route now answers 404 for a request in another tenant or of another principal. New `createInProcessFetch(app, { basePath? })` returns a fetch-shaped function that dispatches to the engine in this process, for a client's `fetcher`; `@flow-state-dev/node`'s `createServerApp` dispatches through it (FIX-2162).
