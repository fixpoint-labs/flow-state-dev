---
"@flow-state-dev/client": patch
"@flow-state-dev/react": patch
"@flow-state-dev/node": patch
---

New `apiPath` option on every client constructor and on `FlowProvider` names where the server mounts the flow API (default `/api/flows`), so the client and React hooks can reach a Node server started with a custom `basePath`. Requests go to `baseUrl` + `apiPath` + route; with `apiPath` unset, every URL is unchanged. The `@flow-state-dev/node` README documents pairing `basePath` with `apiPath` (FIX-1677).
