# F2 · plan shape for closing the cross-org instance gap

A plan for [FIX-1529](https://linear.app/fixpoint-labs/issue/FIX-1529), written from this
Explore's evidence. It is not a spec and not a second implementation. FIX-1529 owns the
build. This page names the surfaces, the smallest fail-closed change at each one, and the
experiments that would catch a fix that only looks closed. Leg ids point at the two POCs
([owner planes](poc/owner-planes/README.md), [security model](poc/security-model/README.md)).

## The problem, in one paragraph

A run takes its **data** from the session, and that path is gated end to end (S1, F3, M3).
A run takes its **configuration** from the flow instance it was addressed through, and
nothing ties an instance to the org that hired it. So a globex user can open a session on
`acme.eng.lead` and run it with acme's instructions (F2, observed), model and tools (read,
not run). The catalog lists that address to everyone (F1, C8). See
[SECURITY-MODEL.md](SECURITY-MODEL.md) for the full model.

## The one rule the fix has to follow

**Every hired instance carries an owner pin, and every entry reads the pin, never the
address.** The pin is `{ orgId, userId? }`. `orgId` is the owning org (acceptance 1–3).
`userId` is present only for a user-owned hire (acceptance 5).

- **The pin is not parsed from the address.** An address is a naming convention the caller
  can see and type. `acme.eng.lead` looking like acme's is not evidence that it is.
- **The pin is not the roster owner.** The roster owner is a row-level fact. The pin is the
  security projection the engine enforces, derived from it at registration. The two don't
  collapse into each other.
- **Unpinned means shared.** App and kind flows stay unbound and global, as the Architect
  enrich locks.

## Surfaces, and the smallest fail-closed change at each

| # | Surface | Today | Smallest change | Proves |
|---|---|---|---|---|
| a | **Hire row** (`roster/collections.ts`) | `{ seatId, flow, settings, instructions }`, org cell. No owner on the row | Add `owningOrgId` and `ownerUserId`, both `.nullable().default(null)` (BP-023, BP-030). A legacy row reads as org-owned by the cell it sits in | 1 |
| b | **Reload** (`reloadHiredSeats`) | The org comes from which cell was read. The row is never compared against it | Refuse a row whose `owningOrgId` disagrees with the cell it was read from. It becomes a named `problem` and is never registered | 3 |
| c | **Registration** (`FlowRegistry.register`, the kitchen-sink registrar, the seat-hire tools) | `register(flow)`. No owner; the id is the only key | `register(flow, { pin })`. The registry holds the pin per address. Re-registering an address with a different pin refuses. A hire writer that omits the pin for a hired seat refuses | 1, 3 |
| d | **Open session** (`create_session`; `execute_action` with no session) | Any authenticated caller, on any instance | Before the ack, compare the caller to the pin. A mismatch answers exactly as an unregistered flow does (`404 Unknown flow`), so the address can't be probed | 2, 5 |
| e | **Admission** (`createExecutionContext`, after the org binding) | Checks session ↔ principal, never session ↔ instance | Compare the session's `orgId`/`userId` to the instance's pin. A mismatch throws a named error before any block runs. This is the net under every other door: resumed sessions, retry and continue, dispatched child sessions, webhooks, schedules, MCP | 3, 5 |
| f | **Catalog** (`GET /api/flows`) | Auth-exempt; lists every instance | Resolve the principal if one is present, without making the route 401. Omit every pinned instance the caller doesn't match. An anonymous caller sees unpinned flows only | 2 |
| g | **Roster read** (the collection's browser read) | `client.state.read: true` with `expose: [seatId, flow, instructions]`: every org member lists every row | A user-owned row must not come back to another member of the org. See the open wall below | 5 |

Why (d) and (e) are both needed:
- (d) alone misses every path that isn't a fresh session. A globex session opened on
  `acme.eng.lead` before the fix lands keeps working after a restart unless admission
  re-checks it. That is acceptance 3.
- (e) alone refuses after the `202` ack, so the request is never discoverable. That is the
  "Found on the way" bug in the [README](README.md#found-on-the-way). (d) keeps the common
  case synchronous.

Legacy sessions with no `flowId` resolve their instance the same way `route-auth.ts` does
today. An ambiguous one is refused, not guessed.

## The open wall: where a user-owned row lives

The Architect enrich leaves this open, and acceptance 5 depends on it. Surface (g) means
"org cell, same collection" leaks Alice's instructions to Bob through the collection read.
The two honest options:

1. **The org cell, under a private sub-prefix with no browser read.**
   - How: `workforce/roster/` stays the org roster. User-owned rows go under a nested key
     the org collection's single-segment `*` doesn't match. Alice lists hers through a
     server action filtered on her principal.
   - For: one store, and the reload is still one prefix read per org.
   - Against: it depends on the list route honouring the pattern rather than the prefix.
     Experiment E4 settles that.
2. **The user cell, keyed `<org>/<seatId>`**, as the owner-planes POC does.
   - For: the storage boundary is the user boundary.
   - Against: the reload has to enumerate users. Alice's rows from one org also show up in
     her own browser read in another org (C7).

**Recommendation: option 1. E4 has now run and passed.** The collection read honours its
single-segment pattern, so a nested `~alice/research` key never reaches bob's read, while the
reload's one prefix read still returns it
([f2-experiments](poc/f2-experiments/README.md)). Option 1 keeps "one hire store" literal,
keeps the reload per-org, and never places another org's rows anywhere a session can list
them. The Architect's stamp on #2070 leans the same way: if E4 had failed, the fallback
would have been dropping the browser read, not a second store.

One caution for the build: the sub-prefix hides a row from the *browser read* only. Any flow
in the org that declares a collection over `workforce/roster/**` can still read it on the
server. Nothing should declare one, and the FIX-1529 suite should pin that.

## Experiments worth running

Each has concrete steps and an expected refusal. "Before" means run it before the fix lands,
to show the hole. "Alongside" means make it a leg of the FIX-1529 suite.

**The before legs have run** ([f2-experiments](poc/f2-experiments/README.md), 8 green on
today's code):
- E3 and E7 confirm the fix can't stop at `create_session`. A session opened through the
  hole survives a restart and resumes as `mallory@globex` with acme's instructions. A globex
  session reaches acme's seat through `internal` dispatch without ever opening a session on
  it.
- E4 passed, and settles the open wall above.
- E1, E2, E5 and E8 pin today's holes.
- E9 shows a held address already refuses a second registration.

| Id | When | Steps | Expected |
|---|---|---|---|
| E1 | alongside | Hire `acme.eng.lead`. mallory@globex opens a session on it | `404 Unknown flow`; nothing written; no request record. Today: `202` and the run carries acme's instructions (F2) |
| E2 | alongside | Hire a user-owned seat for alice@acme. bob@acme opens a session on it, then posts a session-less action to it | Both `404`; no `202` first |
| E3 | before + alongside | **Wrong-org restart.** On today's code, open a globex session on `acme.eng.lead` (the F2 hole). Apply the fix, restart, reload, resume that session | Admission refuses with the named mismatch error; no block runs; acme's cells and globex's cells untouched |
| E4 | before | Write a row at the private sub-prefix in acme's org cell. As bob@acme, list the roster collection through the browser route | The row is absent. If it's present, option 1 is off the table |
| E5 | alongside | Store a row in acme's cell whose `owningOrgId` is `globex`. Boot | Reload reports a named problem; the address is not registered |
| E6 | alongside | **Pin, not address.** Register an instance whose id reads `acme.x` with pin `globex` | acme callers refused; globex callers admitted. Any code that reads ownership off the address fails this |
| E7 | alongside | **Soft-mix through dispatch.** A globex board dispatches to `acme.eng.lead`. An acme org board drains onto alice's user-owned seat as bob's session | Both refused at admission (e); the row is not claimed |
| E8 | alongside | Catalog as mallory@globex, as bob@acme, and anonymous | No `acme.*` for mallory; no alice seat for bob; unpinned flows only for anonymous |
| E9 | alongside | Re-register `acme.eng.lead` with pin `globex` while it is held with pin `acme` | Refused at registration |

E3 and E7 are the two most likely to catch a fix that only gates the session-create route.

## What would falsify a FIX-1529 implementation

A fix that passes the acceptance tests can still be open. It is not closed if any of these
is true:

- The owner is read from the address (E6).
- The check sits only on `create_session` (E3, E7).
- A foreign instance acks `202` before refusing (E1, E2).
- The catalog is filtered in kitchen-sink rather than in the route (the invent-kill on
  KS-only fences).
- A hire writer can register a hired seat without a pin, including the seat-hire tools in
  flight on fixpoint-labs/flow-state-dev#2079 (c).
- A reloaded row can name an org other than the cell it came from (E5).

## Inside the invent-kills

- One hire store: new nullable fields on the existing row.
- No `UserWorkforce`, Spaces, notify mint, or assign-to-userIds.
- No ambient org roster: org-owned rows keep the browser read FIX-1475 gave them; user-owned
  rows lose it.
- The roster owner stays on the row, and principal→org stays the security check. The pin
  sits between them, and neither replaces the other.
- Nothing here teaches hire planes. That stays soft-after
  [FIX-1486](https://linear.app/fixpoint-labs/issue/FIX-1486).

## Not covered

- **Unverified apps.** Every caller is `DEFAULT_ORG_ID`, so every pin matches and the fence
  is a no-op. That is the documented dev-only mode, not a gap. X1 (a runtime hire under
  `DEFAULT_ORG_ID` makes the reload reject) is separate and still open.
- **What a seat's tools reach outside FSD.** The pin stops another org from *running* the
  seat. It says nothing about credentials the seat's tools hold.
