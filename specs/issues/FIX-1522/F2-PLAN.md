# F2 · plan shape for closing the cross-org instance gap

A plan for [FIX-1529](https://linear.app/fixpoint-labs/issue/FIX-1529), written from this
Explore's evidence. It is not a spec and not a second implementation. FIX-1529 owns the
build. This page names the surfaces, the smallest fail-closed change at each one, and the
experiments that would catch a fix that only looks closed. Leg ids point at the two POCs
([owner planes](poc/owner-planes/README.md), [security model](poc/security-model/README.md)).

## At a glance

![A scoreboard of nine experiments, each red on main and green on the FIX-1529 branch, plus three open probes](figures/19-f2-scoreboard.svg)

**What changes, leg by leg.** The left column is today on `main`, and the right is the
FIX-1529 branch (fixpoint-labs/flow-state-dev#2091). Every plan leg flips. The probes at the
bottom sat outside the paths this plan named: all three were open on #2091's first head and
closed on its second. B4 is a debug-mode note.

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

![Two panels: before, a caller reaches acme's seat with nothing checking the owner; after, the registry holds a pin and every entry reads it](figures/12-f2-the-rule.svg)

**The whole fix is the right-hand box.** Before, the address is the only key, so a globex
caller runs acme's config. After, the registry holds a pin beside the address, and every
entry compares the caller to it before any block runs.

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

![Seven surfaces, each with its before state in red and its after state in green](figures/13-f2-seven-surfaces.svg)

**Read across each row.** Every surface keeps its shape. The change is one field, one
comparison or one filter, and the right-hand column names the acceptance item it proves.

Why (d) and (e) are both needed:
- (d) alone misses every path that isn't a fresh session. A globex session opened on
  `acme.eng.lead` before the fix lands keeps working after a restart unless admission
  re-checks it. That is acceptance 3.
- (e) alone refuses after the `202` ack, so the request is never discoverable. That is the
  "Found on the way" bug in the [README](README.md#found-on-the-way). (d) keeps the common
  case synchronous.

![Seven ways into a seat. Before, all reach it. After, fresh HTTP entries stop at check d and everything else at check e](figures/14-f2-every-door.svg)

**Two checks, seven doors.** (d) answers the three fresh entries before anything is written.
(e) is the net under all of them, including the four that never open a session.

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

![Acme's org cell with flat and nested roster keys, and four readers: two that hold and two that don't](figures/17-f2-roster-readers.svg)

**Who can read a private row.** Every reader holds on #2091's second head. The private writer
is branded and scoped to the caller's own rows (probes B and B2), and any other deep pattern
is refused when it's defined (probe C). The amber note is B4: debug endpoints read the store
directly, so they must stay off in a multi-user deployment.

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

![E3 in two lanes: before, a session opened through the hole survives a restart and runs acme's prompt; after, the reload pins the seat and the resume is refused](figures/15-f2-e3-restart.svg)

**E3, the reason (e) exists.** The session already exists when the fix ships. Only admission
can refuse it.

![E7 in two lanes: before, a globex session's dispatch runs acme's seat; after, admission refuses it](figures/16-f2-e7-dispatch.svg)

**E7 never touches `create_session`.** The dispatch seam creates the child session itself,
so a fix that guards only session creation would leave this open. Its board-drain leg (an org
board draining onto a user-owned seat) is tracked as
[FIX-1534](https://linear.app/fixpoint-labs/issue/FIX-1534).

![The flow catalog per caller: before, everyone sees every seat; after, each caller sees only matching seats](figures/18-f2-catalog.svg)

**E8, the catalog.** Green on the right means the pin decides who sees a seat. An anonymous
caller still gets a `200`, with shared flows only.

## Found on the FIX-1529 branch

The after suite ([f2-experiments](poc/f2-experiments/README.md#after-run-against-the-fix-1529-branch))
ran twice on #2091:
- **`01b29f0d`, 9 passed.** Every plan leg was closed. Three probes found gaps outside the
  paths above.
- **`fdca49fd`, 11 passed.** All three probes are closed. B and C are shown in the roster
  figure. A is here:

![Probe A: two users' private seats with the same name share one address on #2091; the proposal gives each user its own address](figures/20-f2-address-collision.svg)

**A user-owned address needs the user in it, and now has it.** The pin stays the fence. The
address only has to be unique.

## Resource planes for one person in two orgs

Alice belongs to Acme and Globex. Her private hires are already separate instances, one per
`{ orgId, userId }` pin. This section is about her **resources**. There are three planes, and
each is a different storage cell. The legs are R1–R3 in the
[after suite](poc/f2-experiments/README.md), run on #2091 at `fdca49fd`.

![Alice's user cell shared by both sessions, Acme's and Globex's separate org cells, and two separate hires with their own pins and state keys](figures/21-f2-resource-planes.svg)

| Plane | What it's for | Where it lives | Follows Alice across orgs? | F2's part |
|---|---|---|---|---|
| **1 · Alice's own** | preferences, memory, the identity bag | the user cell, keyed by her user id. Any resource declared `scope: "user"` and not flow-isolated | **Yes, always** (S2, R1) | None. This is the engine's existing user scope, unchanged |
| **2 · Org-bound** | org data, anything an org's work produces, shared rooms and boards | the org cell, keyed by the **session's** org, which comes from the verified principal and never changes | **No** (S1, R2) | The data path was already fenced. F2 stops another org running Acme's config against it |
| **3 · Hire-private** | one hire's row, config and working state | Row: the hiring org's cell at `workforce/roster/~alice/<seat>`. Address `acme.~alice.<seat>`, pin `{acme, alice}`. Config: instructions and tools on the row. State: `scope: "user"` with `flowIsolation: true`, keyed `alice:acme.~alice.<seat>` | **No.** Acme-Alice and Globex-Alice are two hires, two pins, two keys (R3) | The row (B, B2, C) and the instance (E1–E9) |

**Plane 1 is a real plane, not a leftover.** It's the engine's `user` scope, and it already
exists. What it lacks is a choice. Every shared user-scoped resource follows Alice into every
org. Nothing lets one resource say "Acme only". That choice is the user-within-org cell from
[README decision 1](README.md#decided), filed as the storage-cell engine issue under
[FIX-1538](https://linear.app/fixpoint-labs/issue/FIX-1538/a-users-private-team-stays-in-the-org-it-was-built-in).

**On the rule of thumb for plane 2.** It's close, but the deciding fact is not who creates the
resource. It's the **scope the resource declares**, together with the session's org:
- An org-scoped resource written from Alice's Acme session lands in Acme's cell, whoever wrote it.
- A user-scoped resource written by an org flow still lands in Alice's user cell, and follows her to Globex.

So "an org flow creates it" gives an org-bound resource only when that flow declares
`scope: "org"`. Org-shared resources are the same cell: every member's session in Acme reads
and writes Acme's one org cell (M1).

**Plane 3 needs the kind to isolate, and Workforce's doesn't by default.**
- R3 passes because its resource declares `flowIsolation: true`. With the flag removed, R3 goes
  red: the Acme hire's note shows up under the Globex hire.
- Workforce's shipped seat kind defaults `isolateUserState: false`. Only its skill catalog is
  isolated per seat. So a hire's user-scoped state, such as memory, is plane 1 today, and it is
  shared by Alice's hires in both orgs.
- It's still Alice's own data, so this isn't a cross-tenant leak and isn't a Critical on #2091.
  Per-resource isolation for seat kinds is soft-after
  [FIX-1396](https://linear.app/fixpoint-labs/issue/FIX-1396).

### Alice's day, in three resources

- **A preference.** She picks a dark theme while working in Acme. When she opens Globex, it's
  dark there too. Plane 1, by design (R1).
- **An artifact.** Her Acme session writes the roadmap doc into an org-scoped resource. It's in
  Acme's cell. Her Globex session reads an empty doc, and an Acme re-read still sees it (R2).
- **A custom tool.** She gives her Acme hire, `acme.~alice.helper`, a custom tool. The tool is
  part of the hire's config on its row, so it runs only through that pinned instance.
  - A Globex session can't reach it (E1, E6).
  - Her Globex hire is a different hire with its own config, and doesn't have the tool.
  - Notes the Acme hire keeps in an isolated resource stay with it (R3).

### Invent-kills and soft-later

**Invent-kills:**
- Soft-mixing a Globex session into the Acme hire's private prefix. The pin refuses it at admission, and the branded writer only reaches the caller's own rows (E1, B2).
- An ambient "user mega-roster" across orgs. Roster rows live in each org's cell and reload per org. Nothing lists all of Alice's hires from one session, and nothing should.
- Folding plane 3 into plane 1. Hire-private state must not rely on the shared user cell.
- Reading org membership out of the user bag. Membership is the verifier's (M2).

**Soft-later:**
- The user-within-org cell, so one resource can stay in one org. Filed as the storage-cell
  engine issue under FIX-1538.
- Org ACLs and roles. Not filed.
- Tenant and auth rework (FIX-1503).
- A full user-bag product. Not filed.
- Per-resource isolation for seat kinds (FIX-1396).
- Caller-scoping on the debug listing (B4), filed as
  [FIX-1535](https://linear.app/fixpoint-labs/issue/FIX-1535).

## What would falsify a FIX-1529 implementation

A fix that passes the acceptance tests can still be open. It is not closed if any of these
is true:

- The owner is read from the address (E6).
- The check sits only on `create_session` (E3, E7).
- A foreign instance acks `202` before refusing (E1, E2).
- The catalog is filtered in kitchen-sink rather than in the route (the invent-kill on
  KS-only fences).
- A hire writer can register a hired seat without a pin, including the seat-hire tools
  shipped in fixpoint-labs/flow-state-dev#2079 (c).
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
  `DEFAULT_ORG_ID` makes the reload reject) is separate, filed as
  [FIX-1536](https://linear.app/fixpoint-labs/issue/FIX-1536).
- **What a seat's tools reach outside FSD.** The pin stops another org from *running* the
  seat. It says nothing about credentials the seat's tools hold.
