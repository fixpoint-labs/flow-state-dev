---
title: Auth and tenancy
type: concept
description: Your app says who is calling and which organization they belong to. Flow State makes sure each request stays inside them.
---

import Figure from "@site/src/components/Figure";
import WhoseJob from "./figures/whose-job-is-what.svg";
import OrgsUsersTenants from "./figures/organizations-users-tenants.svg";

# Auth and tenancy

Flow State does not log anyone in. Your app checks the credential a request carries, whether that is a session cookie, a token or a shared secret, and tells the framework who is calling and which organization they belong to. The framework takes it from there: every session, request and stored record belongs to one user in one organization, and a request can only reach what belongs to the identity it arrived with.

The work is split because proving who you are differs from app to app, while the check that Bob cannot read Alice's session is the same in all of them. You write the first part once. You never write the second.

The example is a support desk: a `support` flow, a self-contained system your app exposes, with a `reply` action a client calls. A session is where a flow keeps a run of requests together, here one customer conversation. Each call to `reply` is a request, and the framework keeps a record of it. Alice and Bob are users. `acme` and `globex` are organizations.

<Figure svg={WhoseJob} caption="Your app says who is calling, the framework checks the rest" description={"Three boxes left to right. Your app holds a session cookie, a JWT or a shared secret, and checks the credential. An arrow labelled tells runs to the resolver, the highlighted middle box, where resolvePrincipal returns a userId and an orgId. A second arrow runs to the framework's checks, a tall box listing session owner, organization and body fields ignored. A third arrow runs down from the resolver to Bob's request for session s1, which is Alice's. A red line from that request ends in a bar before the framework's box and is marked refused: the answer is the same 404 an unused id gets. Two notes say that your app proves who is calling, and that a request for someone else's session is refused."} />

## Tell the framework who is calling

A flow declares an `authentication` hook. Its `resolvePrincipal` function runs once for each request and returns the user and organization. That pair is called the principal.

```ts title="src/flows/support/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { getSession } from "../../lib/session";
import { reply } from "./blocks/reply";

export const supportFlow = defineFlow({
  kind: "support",
  authentication: {
    requireUser: true,
    resolvePrincipal: async ({ request }) => {
      if (request === undefined) return null;
      const session = await getSession(request);
      if (session === null) return null;
      return { userId: session.user.id, orgId: session.user.orgId };
    },
  },
  actions: { reply: { block: reply, description: "Answer a customer message." } },
});

export default supportFlow();
```

`getSession` is your own helper in `src/lib/session.ts`. It reads your cookie and returns the signed-in user, or `null`. `reply` is a block, the unit of work the action runs, in `src/flows/support/blocks/reply.ts`. `request` exists only when the caller came over HTTP, so this resolver accepts HTTP callers only. [Serving flows](./serving-flows.md) covers the other ways in. When the resolver returns `null`, the framework answers 401.

`requireUser: true` is the default, so you can leave it out. It only checks that the request ended up with a user id. Verifying the credential is the resolver's job.

A principal with no `orgId` is refused, so every request lands in exactly one organization.

A server calling in, with no end user, can authenticate with a shared secret. The helper checks the `Authorization: Bearer` header and returns the principal you give it.

```ts title="src/lib/service-resolver.ts"
import { createBearerSecretPrincipalResolver } from "@flow-state-dev/engine";

export function serviceResolver(secret: string) {
  return createBearerSecretPrincipalResolver({
    secret,
    principal: { userId: "helpdesk-bot", orgId: "acme" },
  });
}
```

It is one secret for one principal, so per-customer keys or tokens mean writing `resolvePrincipal` yourself. The [Authentication reference](../reference/authentication.md) has the options and what a wrong secret gets.

## What the framework checks

With a resolver configured, identity comes from the principal and nowhere else. A `userId` or `orgId` in a request body is ignored: Bob's credential with `{ userId: "alice" }` in the body creates a session owned by Bob.

Every route that names a session or a request checks that the principal owns it. Bob asking for Alice's session `s1` gets the same 404 as an id nobody has used. The [Authentication reference](../reference/authentication.md) lists the status each route answers.

A session also keeps the user and organization it was created with. If Alice opens a session while acting for `acme`, then reads it while acting for `globex`, she gets 403. A `reply` call on it gets 404, as for a session that does not exist. To work under another organization, or to hand a conversation to someone else, create a new session.

With no resolver, the framework takes `userId` from the request body, and any caller can read any session. Use that for development only. Only `serve()` and `fsdev dev` on a loopback host serve such a flow without an override. The Next.js, Vercel and Lambda handlers refuse every request with a 500 unless given `allowUnauthenticated: true`.

## Tenants

An organization splits users. A tenant splits sessions. When one deployment serves several customers, each customer is a tenant, and its id travels in the `x-tenant-id` header. Set it from your gateway, the way you attach an auth header.

<Figure svg={OrgsUsersTenants} caption="Organizations split user records, tenants split sessions" description={"Four hatched boxes side by side, hatched meaning they outlive the request. The first two, under the heading split by organization, are the organizations acme and globex. Each holds a box for alice, her user records, and a box for org state. Alice's box in globex is a second, separate copy. The other two, under split by tenant, are the tenants northwind and contoso. Each holds a session named chat-1, and contoso's is highlighted: same id, its own record. Both tenant boxes say that user and org records are not split here. Two notes say that user records are kept per organization, and that a tenant splits sessions only."} />

Two tenants can both use session id `chat-1` and get two records, with separate state. The [Authentication reference](../reference/authentication.md) covers what a wrong or missing tenant gets.

The framework does not check the tenant header against the credential, so whatever sets it needs to be something you trust. User and organization records are not split by tenant, and the [Persistence reference](../reference/stores.md) shows what each record is keyed by.

## What it gets you

- **No ownership checks to write.** You do not write the code that stops Bob reading Alice's session or request. A listing returns only the caller's own sessions.
- **No identity from the client.** A caller cannot pick its user or organization by putting them in a body.
- **No crossing between organizations.** Alice's `acme` session stays out of reach of a request that arrives as Alice in `globex`.
- **Customers that never meet.** Two tenants can share a session id and never see each other's state.

## How it fits with the others

A flow's data is filed by user, organization and session, which [State and scopes](./state-and-scopes.md) covers. Isolation flags on a flow keep its data apart from other flows, and decide where that data is filed, not who may call. The same `authentication` hook runs for every way a flow is reached, which [Serving flows](./serving-flows.md) covers.

## Next

- [Authentication reference](../reference/authentication.md) has the resolution order, every status a resolver can choose, what happens when a request's session belongs to someone else, and how auth works when one flow calls another.
- [Flows reference](../reference/flows.md) covers the isolation flags.
- [State and scopes](./state-and-scopes.md) shows what each scope is keyed by.
- [Serving flows](./serving-flows.md) shows how requests reach a flow.
