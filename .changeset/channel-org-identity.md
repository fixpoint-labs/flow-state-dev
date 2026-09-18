---
"@flow-state-dev/workforce": minor
---

`openChannels` takes an `orgId`, so a channel's session is opened under the org its documents are scoped to (FIX-1412).

```ts
await openChannels(channels, { client: sessionClient, userId: "u_42", orgId: "org_acme" });
```

A document declared under the resources convention installs at `scope: "org"`, and an org-scoped lookup is matched against the org the session was opened under. Without one, a seat woken through the channel resolves every declared document as unregistered. A session's org is fixed at creation, so this is the only moment it can be set.

Optional, and unchanged for an app that has no orgs: pass nothing and no org key is sent.
