# POC · org- and user-owned Workforce planes

An experiment retained as evidence for [FIX-1522](../../README.md). Not production code: nothing
imports it, it has no package manifest, and it is outside default build, test, lint and knip
discovery ([specs/README.md](../../../../README.md)).

## What it checks

Whether one hire store can serve an org's team and each user's private team inside one app, with
hard isolation between them, and what happens when an org-hired "bridge" seat tries to reach a
user's plane. Every result comes from the real `/api/flows` router under a verified principal
(`x-verified-user` / `x-verified-org`, standing in for a real verifier). Nothing is stubbed.

| File | What it is |
|---|---|
| `plane.ts` | The candidate shape: `WorkforceOwner`, the plane's address and row key, the roster at the owner's scope, a per-plane seed ledger, `assertOwnPlane`, and `reloadPlane`. Written to be portable into `packages/workforce/src/roster/` if the direction is taken |
| `planes.poc.test.ts` | 24 legs, A–D plus one side finding. Names ending in `LEAK` or `MIS-FILE` pin what is true **today**, not what should be |
| `run.sh` | Copies both files into `packages/workforce/test/`, runs them, removes them |

## How to run it

```bash
pnpm install          # once per checkout
bash specs/issues/FIX-1522/poc/owner-planes/run.sh
```

## What was observed

Run against `main` at `d8d4c26`: **24 passed**. The legs, in the order the figures use them:

| Leg | Claim | Observed |
|---|---|---|
| A1 | One row schema and prefix; the owner picks the cell | org row at `("org","acme","workforce/roster/eng.lead")`, alice's at `("user","alice","workforce/roster/acme/research.scout")`, nothing in svc's cell |
| A2 | A reload per plane registers both seats | `acme.eng.lead` and `acme.~alice.research.scout` |
| A3 | An org row cannot borrow a user address | `planeAddress("acme", org, "~alice.eng.lead")` throws |
| A4 | An opaque principal id still makes a seat that reloads | `alice@example.com` hires and reloads at `acme.~alice%40example%2Ecom.research.scout`. User ids are escaped (`%XX` for anything outside `[a-z0-9-]`), not held to the folder-name rule |
| B1 | `create-if-absent` seeding resurrects a fired seat | roster after reseed: critic, **editor**, scout |
| B2 | A per-plane seed ledger holds the evolved roster | critic, scout |
| B3 | Each plane seeds on its own first open, and only its own | bob's and the org's cells empty until bob seeds |
| B4 | A user's plane in a second org seeds on its own first open | seeding at `acme` does not mark `globex` seeded: two `globex/…` rows. The user ledger is keyed `<org>/<pack>` |
| B5 | A bumped pack version is recorded and hires nothing | ledger reads `acme/starter` v2, and the fired seat stays fired |
| C1 | Bob reads only his plane, whatever he claims | `["ops.pager"]`, with `userId: alice` in the body and an `x-user-id: alice` header |
| C2 | Bob can't act in alice's session | read → `403`. Action → **`202`**, then refused at admission by `UserBindingMismatchError` with no request record. Nothing written anywhere |
| C3 | Unguarded, an org session filing onto alice's board… | completes, and the task sits in **svc's own** user cell. Alice sees nothing |
| C4 | …guarded, is refused by name | request `failed`: `plane user:alice is not this session's` |
| C5 | An org session's drain can't reach alice's rows | alice's task stays `pending` until alice drains it |
| C6 | The org roster never carries user seats | `[]` |
| C7 | **LEAK**: a user plane's browser read spans orgs | alice, signed into `globex`, reads topic `acme/research.scout` |
| C8 | **LEAK**: the catalog lists every seat to everyone | `GET /api/flows` shows `acme.~alice.research.scout` to bob and to `mallory@globex` |
| C9 | **LEAK**: the shipped `channelBoard` is org-scoped whoever owns the channel | bob reads alice's task `private-plan` |
| C10 | **LEAK**: the shipped seat inventory is org-scoped | alice's seat row lands at `("org","acme","inventory/seats/…")` |
| D1 | A bridge seat filing for alice, from its own session | completes into svc's cell. Alice sees nothing |
| D2 | The bridge's own flow acting in alice's session | into her app session: **`409 wrong-instance-session`**. Into a session she opened on the bridge seat: `202`, then dropped, as C2. Nothing written |
| D3 | The same through the bridge, claiming `userId: alice` in the body | `202`, then dropped. Its own session ignores the claim too |
| D4 | Without verified identity the bridge "works" | it creates a session as alice and files onto her board. That is impersonation, not a bridge |
| X1 | A runtime hire under `DEFAULT_ORG_ID` is written, then fails the boot | the row is stored, and shipped `reloadHiredSeats` **rejects**: `Organization id "__fsd_default_org__" must be lowercase…` |

### Controls — each check was seen to fail

- **Isolation comes from the scope, not the key.** With the user roster moved to `scope: "org"`
  and the owner put in the key instead (`~alice/<seatId>`), C1 fails with
  `expected [ 'ops.pager', 'research.scout' ] to deeply equal [ 'ops.pager' ]`: bob reads alice's
  seat.
- **The guard is what refuses.** C3 is C4 with the guard off. Same input, and the write lands in
  the wrong cell.
- **The ledger is what holds.** B1 is B2 with the ledger off. Keying the user ledger by pack
  alone fails B4 (`expected [] to have a length of 2`), and dropping the version update fails B5.
- **The escaping is what lets opaque ids through.** With the raw user id in the address, A4
  fails (`acme.~al.ice.eng.lead`, a dotted id that no longer splits).
- **C2's silent `202` is `UserBindingMismatchError`.** Confirmed by instrumenting the throw in
  `createExecutionContext.ts` during one run (`alice` vs `bob`) and then reverting it.

## Limits

- The bridge is a registered collection seat driven over HTTP. No generator runs, so nothing here
  covers a model choosing to call a cross-plane tool. The fence is below the model, so the result
  should not change, but that has not been run.
- Boards are written through the collection door (`create` / `list` / `patchState`), not
  `taskTools`. The rows' cell is what the legs test, and both doors resolve the same declaration.
- Channel *open* for a user plane was not run. A session is already owned by one user, so a user's
  channel is a session the user opens. The channel **board** (C9) is the part that breaks.
- In-memory store only. Scope-cell keying is shared by every adapter, but no adapter was run.
