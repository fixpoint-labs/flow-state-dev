# Workforce POC lab E — scoped resources

Workforce Atlas §06 says knowledge is **where the resource lives**, not a
Knowledge type. This lab writes and reads goals or lessons at every scope
today's APIs can express. It is a never-merge POC, not a product.

## The proof

Four uses. Three Layer 1 scopes (`session` | `user` | `org`). Content is
`writeContent` / `readContent`. Empty reads `null`.

```bash
# From this directory. Isolation across users / orgs / flow kinds is the test.
pnpm test

# Same-principal smoke. `fsdev run` hardcodes userId `cli-user` and has no --org.
pnpm fsdev run workforce-poc-e writeUserGoals \
  -i '{"body":"Ship the intake form this week."}' \
  --session dm

pnpm fsdev run workforce-poc-e readUserGoals -i '{}' \
  --session launch-room
```

`workforce-poc-e-other` is the second flow kind for the isolation proof.
Same resource objects. Different `flowKind`.

## Exists vs gap

| Claim | Status | Pin |
| --- | --- | --- |
| User-private goals are `scope: "user"` content | **exists** | `defineResource({ scope: "user" })`. Stored at `(userId, ref)`. Shared across that human's sessions and flow kinds. Isolated from other users. |
| Org lessons are `scope: "org"` content | **exists** | `defineResource({ scope: "org" })`. Stored at `(orgId, ref)`. Shared across users and flows in that org. Isolated from other orgs. Not the user-private row. |
| Team / roster goals | **exists as convention; no `scope: "team"`** | `defineResourceCollection({ pattern: "rosters/[rosterId]/[doc]", scope: "org" })`. Isolation is the collection key plus org. Atlas already draws this. A `Team` type or `scope: "team"` would be invented. `defineResource` rejects `"team"`. |
| Member / Agent identity | **named gap** | No `scope: "member"` / `"agent"`. `Agent` has no store. `flowIsolation: true` on a user resource keys `(userId, flowKind, ref)` — per kind, not per seat. A DM and a project room of the same kind share the row. A second kind does not see it. Two seats of the same kind share it. That is the proof atlas asked for. It is not per-seat identity. Do not put `Agent.memory` on the type to close it. |
| Knowledge type / OKF | **cut** | Not imported. Rows are content on existing resources. |

## What this is not

- Not `@flow-state-dev/workforce`
- Not `@flow-state-dev/memory` (four tiers over session/user — a different package, not this convention)
- Not a Knowledge / Team / Member L1 package
- Not OKF or a parallel graph

## Finding

User and org hold goals and lessons honestly. Team is the same write, keyed
by roster on org — no fourth scope. Member identity is the named gap:
`flowIsolation` is per flow kind. Stop. Do not invent a Knowledge store.
