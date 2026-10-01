# POC · project resource → templated talk channel

A throwaway experiment for [FIX-1728](https://linear.app/fixpoint-labs/issue/FIX-1728). It is
not production code, not a workspace package, and is in no default build, test, lint or knip
discovery. Nothing outside this folder imports it.

## The question

Can CoS create a project as an **org resource** and, on that create, open a **user-bound
talk session** from the channel binder we already have — with an explicit link, and
without putting the project in session state, declaring it in the tree, or turning
isolation-off into a shared room?

If the shipped binder cannot open a hand-built record, or if the only way to talk
"about" a project is to stuff its fields into the session, the convention spike is
drawing a shape the runtime cannot hold.

## How to run it

```bash
pnpm exec tsx specs/issues/FIX-1728/poc/project-talk-channel/check.mts
```

Exit code is 0 when every check and every control behaves. No install step beyond the
repo's own `pnpm install`. No production module is registered.

## The pattern

```
CoS create
   │
   ├─ upsert org resource  projects/<id>     name, status, owner, links, talkSessionId
   │
   └─ openChannels(hand-built ChannelManifest)
        session id  = project-talk.<id>      user-bound; kind = existing channel template
        session state = members, instructions, transcript
```

- **Project** = org-scoped resource collection at `projects/*`. Discoverable by any flow
  in the org (`flowIsolation: false` on the **resource**, the same spelling inventory
  uses). Not a `workforce/projects/` folder and not Layer 1.
- **Talk channel** = one session on the built-in `channel` kind (or another kind already
  registered). Opened through `channelInstances` + `openChannels`. Bound to the creating
  `userId`.
- **Link** = `resource.talkSessionId` plus a parseable session id. No third join table.
  Channel session state stays the closed three keys; it does not grow a `resourceId`
  field in this experiment.

`create-project-talk-channel.mts` is the candidate factory a ship would start from. It is
not imported by `packages/workforce`.

## What it checks

| Check | The claim | How it is made falsifiable |
|---|---|---|
| 1 | Create writes durable fields on the resource and opens a user-bound talk session whose state is only members / instructions / transcript | Real helper, in-memory store + session client. The session must not carry name, status, owner, or links |
| 1 control | A dotted project id is refused | Otherwise the `project-talk.<id>` reverse parse is a comment |
| 2 | Two projects are two sessions on one kind | Real `channelInstances`. Two talk rooms bind as one `"channel"` instance |
| 2 control | Naming a second kind is a second instance | If this stayed at one, "session on an existing kind" would be untestable |
| 3 | The project is org-discoverable and invisible to another org | Real collection + `runAction`. Writer and reader are different flows, both with `isolateOrgState: true` |
| 3 control | The other-org empty read is only evidence because the same-org read was not | Vacuous empty would pass if the write never landed |
| 4 | A second `userId` cannot adopt the session | Real `openChannels` refusal. Isolation-off as a shared room would let them in |
| 4 control | The creator re-opening is a no-op | Otherwise "refused" could mean "everything throws" |

## What would abandon this direction

- If `openChannels` required a `CHANNEL.md` on disk — then create is a file write, which
  Jake locked out.
- If two projects minted two flow instances — then create is a new kind, and the
  invent-kill on L1 Project / a second store is the wrong fence.
- If the talk session had to carry name / status / owner to be useful — then the
  resource is a shadow, and the hard fence ("durable data on the org resource only")
  does not hold in code.
- If a second user could open the same session — then we shipped isolation-off as the
  shared project room.

## What it showed

All fourteen assertions passed on this explore head
(`pnpm exec tsx specs/issues/FIX-1728/poc/project-talk-channel/check.mts`).

**Create composes the shipped binder.** An org project row holds name, status,
owner, links, and `talkSessionId`. The talk session opens on the built-in
`channel` kind, bound to the creating user. Session state is only `members`,
`instructions`, and `transcript`. A dotted project id is refused, so the
`project-talk.<id>` reverse parse is a real constraint.

**Two projects are two sessions on one kind.** `channelInstances` binds both
talk rooms as one `"channel"` instance. Naming a second kind is a second
instance.

**The project is org-discoverable.** A different flow in the same org reads the
row even when both flows set `isolateOrgState: true`. A different org reads
nothing. The empty read is only evidence because the same-org read was not.

**A second user cannot adopt the session.** `openChannels` refuses; the session
still belongs to the creator. The creator re-opening is a no-op.

Nothing in the run moved the design. The open walls stay open. The helper stays
out of `packages/workforce`.

## What is NOT solved

- **Convention file.** This is a TypeScript factory. The spike still has to name whether
  a file (and which file) declares "new project → open kind X", or whether the factory
  *is* the convention. Not CHANNELS.md.
- **Where `resourceId` lives on the session.** Channel session state is a closed schema.
  This POC uses a parseable session id plus `talkSessionId` on the resource. Extending
  the schema, using description, or keeping the pointer resource-only is the spike's
  call.
- **Who `userId` is when CoS creates.** The session is one user. CoS? The person? Each
  participant's own session about the same resource? Soft-lean is user/seat-bound; this
  POC opens one session for the caller it was given.
- **Atomicity.** A failed open leaves the resource row. Not repaired here.
- **Workstream resource.** Same family; not built.
- **Shared org room.** Check 4 refuses it. The escape hatch stays an open wall.
- **Inventory join for a room with no `CHANNEL.md`.** FIX-1415 already showed
  discover = declared ∩ inventory, so a runtime-only talk session is invisible to
  Labs discover until that join widens. Not this POC's to close.
- **Shift Manager UI, FIX-1718 rewrite, hire/Roster, Soft B.** Untouched.

## Limits

- It does not run a model, a Lab, or kitchen-sink.
- The session client is in-memory, the same shape the binder tests use. The resource
  half runs through `runAction` on in-memory stores.
- It does not write Postgres or open a browser.
