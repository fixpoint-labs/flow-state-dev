---
"@flow-state-dev/workforce": minor
---

`createWorkforceClient(fsd)` takes the app's one client from `createClient` and works as its user, over its transport. It no longer takes `{ userId, baseUrl, apiPath, fetcher }`; `WorkforceClientOptions` is removed and `WorkforceClientSource` names what it reads (FIX-2162).
