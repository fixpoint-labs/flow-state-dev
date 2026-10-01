# POC · workstream resource → owner talk session

Throwaway evidence for [FIX-1728](https://linear.app/fixpoint-labs/issue/FIX-1728/spike-resource-backed-channel-convention-org-resource-templated-talk).
Not production code. Nothing outside this folder imports it. Sibling of a
project-resource POC: this folder is `workstream-resource/` only.

## The question

Can a workstream be an **org-visible row** (owner + status) while the owner's
**talk session** is minted about that row — and can the org list the work
without reading anyone's session?

## Pattern

```
create org row (ownerUserId, status)
        │
        ▼
hand-built ChannelManifest (description only)
        │
        ▼
openChannels({ userId: owner })     ← session is the owner's
        │
        ▼
stamp metadata.resourceId on create (host wrap, not a CHANNEL.md key)
```

The org list is `workstreams/*` (org scope). It is not `inventory/channels/*`
and not `listSessions`.

`sketch.mts` is the shape a ship would start from. It is not imported by
`packages/workforce`.

## How to run it

```bash
pnpm exec tsx specs/issues/FIX-1728/poc/workstream-resource/check.mts
```

Exit 0 when every check and every control behaves. No install beyond the repo.

## What it checks

| Check | The claim | Control that can fail it |
|---|---|---|
| 1 | Create writes the org row, then mints a talk session bound to the **owner** | Declaring `resourceId` on the channel record is refused — the closed `CHANNEL.md` list does not carry the join |
| 2 | Org list returns owner + status | Deleting both talk sessions leaves the list intact; another org lists nothing |
| 3 | Session state is `members` / `instructions` / `transcript` only | Those owner/status fields **are** on the resource |
| 4 | No `CHANNELS.md`, no L1 `Workstream` type | The sketch still names `defineResourceCollection` and `openChannels` |

## Fences

- **No durable workstream fields in session state.** Owner and status live on
  the org row. The session may carry `metadata.resourceId` — a join, not the
  work.
- **No `CHANNELS.md`.** No static room list. The template is a hand-built
  manifest (`workstreamTalkManifest`) plus `openChannels`.
- **No L1 Workstream type.** Product framing over an org collection + a
  channel session. Workforce is unchanged.

## What would abandon this direction

- If listing the org row required reading the owner's session — then discovery
  still goes through Flow sessions, and the resource is theatre.
- If `openChannels` could not bind the session to the owner user — then
  "session-as-channel for the work" needs a different mint.
- If the only persistable join were a new `CHANNEL.md` key **and** that key
  were treated as durable workstream data — then the closed list and the
  "no data in session" fence fight each other.

## What this did not cover

- Project resources (sibling slice).
- Whether security ever allows an org-shared talk session.
- The convention-file shape for "on create, open talk kind X" if a file is
  wanted later.
- Shift Manager UI. Soft B wakes. A Workstream channel kind thinner than
  `channel`.

## Open questions (Architect)

1. **Where the join lives.** Host wrap on `createSession` metadata (this POC),
   a new optional `CHANNEL.md` key, derived session id only (`ws.<id>`), or
   resource field only. Adding the key is the one workforce diff this POC
   refused, so it does not collide with a project-resource branch.
2. **Same collection family as project, or a second pattern?** Both are
   "org resource + templated talk session". Workstream is user-owned;
   project is CoS/org-owned. One helper with an owner field, or two sketches.
3. **Built-in `channel` kind or a thinner talk kind?** This slice reused
   `channel` (empty `members`, no boards). A workstream is not a seat room.
4. **Does today's Shift Manager "channel = workstream" retire**, or does a
   declared `CHANNEL.md` remain a different thing from this resource?
