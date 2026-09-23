# POC · channel-admin compose

A throwaway experiment retained as design evidence for [FIX-1415](../../SPEC.md). It is not
production code, not a workspace package, and is in no default build, test, lint or knip
discovery. Nothing outside this folder imports it.

## The question

After the rooms an app declared are open, can a teammate find a room that was never in
that roster the same way Labs already look rooms up — and can changing who is in a room
be done by opening it again?

If discover already listed an inventory-only room, [D1](../../DECISIONS.md#d1) is theatre.
If a second `openChannels` rewrote members, invite would be a file edit and this ticket
would be bolting verbs onto the declaration binder.

## How to run it

```bash
pnpm exec tsx specs/issues/FIX-1415/poc/channel-admin-compose/check.mts
```

Exit code is 0 when every check and every control behaves. No install step beyond the repo's
own `pnpm install`. No production module is registered.

## What it checks

| Check | The claim | How it is made falsifiable |
|---|---|---|
| 1 | Discover projects a room only when **both** a declaration and an inventory row exist. A runtime room has no declaration, so it is invisible | Real `workforceManifestSources` over a file room and an inventory-only id. The runtime id must be absent |
| 1 control | Putting that id on the declared half (D1's proposed join) makes it appear | Same inventory, declared set unioned with the runtime id. If it stayed empty, the join would be broken |
| 2 | `channelInstances` returns one instance per kind, not per room | Two built-in rooms bind as one instance whose kind is `channel` |
| 2 control | A second registered kind is a second instance | If this stayed at one, the binder would be collapsing kinds. If check 2 had returned two, create would be minting instances |
| 3 | A record carrying `system:` is refused, and the message says where the room is declared is what decides the lane | Real `channelInstances` throw |
| 3 control | The same record without that key binds | Otherwise the refusal is "everything throws" |
| 4 | `openChannels` on an already-bound room does not change members and does not delete the session | Real binder, in-memory session client, second open with a longer member list |
| 4 control | The binder does delete a session when the id is held by an empty one, and then writes the members | If deletes stayed at 0, the "not deleted" assertion would be blind |
| 5 | The Door B sketch is catalog `tools` named `create`, `delete`, `invite`, `uninvite`, not `controlTools`, not a Channel type. Create defaults `kind` to `channel` and refuses a source field | Inspect `createChannelAdminCapability` and parse its input. Control: a present `controlTools` is what the inspector would fail; a `source` field fails the strict parse |

`sketch-capability.mts` is the shape a ship would start from. It is not imported by
`packages/workforce`. Do not promote it by moving the file. The verb names are the
recommended cut, still open.

## What would abandon Door B

- If `channelInstances` minted one flow instance per room — then create would be a new
  kind, which the issue invent-kills, and the sketch's "session on an existing kind"
  would be the wrong door.
- If discover already listed inventory-only rooms — then D1 is a no-op.
- If a second open rewrote members — then the tool should edit the declaration, and
  the "do not bolt onto FIX-1352" fence would be the wrong fence.
- If the verbs had to be `controlTools` to be callable — then empty `tools:` could not
  stay empty.

## What it showed

All seventeen assertions passed on this explore head.

**Discover withholds a room that has no declaration.** A file-declared room with an
inventory row is listed. A second inventory row whose id is not in the roster is
withheld. Putting that id on the declared half — D1's proposed join — lists it. The
hole is real, and the close is the existing join with a wider declared set.

**Two rooms share one kind.** `channelInstances` binds two built-in rooms as one
instance, kind `channel`. A second registered kind is a second instance.

**The lane is not a file flag.** `system:` is refused, and the message says where the
room is declared is what decides it. The same room without that key binds.

**Invite is not a second open.** Re-opening a bound room leaves the original member
in place and does not delete the session. An empty session on the same id is deleted
and opened with its members, so the delete counter is real.

**The sketch is catalog tools.** `createChannelAdminCapability` is named `channel-admin`,
exposes `create`, `delete`, `invite`, and `uninvite` on `tools`, and has no
`controlTools`. Omitted `kind` parses as `channel`. A `source` field is refused.

Nothing in the run moved the design. D1 is still the call. The four walls are still
open. Door B still composes the session spine that already exists.

## Limits

- It does not run a model. The tools fence is inspected on the capability object, not
  driven through a generator loop. Core already enforces that half; this proves we
  did not put room admin on the bypass.
- It does not call Collab. The mint seam on the sketch is unread by the check on
  purpose. Reaching into `execute` is how a POC pretends it is a unit test of a
  mint that does not exist yet.
- It does not write Postgres. Inventory liveness is the join, already shipped.
- It does not open a browser or kitchen-sink.
