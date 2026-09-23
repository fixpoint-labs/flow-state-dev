# POC · the F2 experiments, before the fix

The "before" half of the experiments in [F2-PLAN.md](../../F2-PLAN.md), run on today's code.
It is experimental evidence for FIX-1529, not production code: nothing imports it, it has no
package manifest, and it is outside default build, test, lint and knip discovery.

Every leg goes through the real `/api/flows` router under a verified principal
(`x-verified-user` / `x-verified-org`). A **HOLE** leg asserts a path that works today and
must be refused once FIX-1529 lands, so the fix turns it red. A **DECIDES** leg settles a
design question.

## How to run it

```bash
pnpm install          # once per checkout
bash specs/issues/FIX-1522/poc/f2-experiments/run.sh
```

## What was observed

Run on this branch (based on `d8d4c26`): **8 passed**.

| Leg | Question | Observed today |
|---|---|---|
| **E3** HOLE | Wrong-org restart: does a session opened through the F2 hole survive a restart? | Yes. mallory@globex opens a session on `acme.eng.lead`. The process restarts over the same stores, and the seat comes back through the shipped `reloadHiredSeats`. Her resumed action completes as `mallory@globex` with acme's instructions. **Control:** bob@acme resuming her session is refused, so the resume path does run admission. What it lacks is an instance ↔ owner check |
| **E7** HOLE | Soft-mix through dispatch: can a globex session hand work to acme's seat without opening a session on it? | Yes. An app action in mallory's globex session sends an `internal` dispatch to `flowKind: "acme.eng.lead"`. The child runs as `mallory@globex` with acme's instructions. Nothing on this path touches `create_session` |
| **E4** DECIDES | Does the roster's browser read honour its pattern, so a nested private key stays out? | Yes. Three rows sit in acme's org cell. bob@acme's collection read returns `eng.lead` and a flat-keyed private row, but not `~alice/research`. The per-org reload's one prefix read still returns all three. **This also pins hole (g):** any row at a flat key, instructions included, is listed to every member of the org |
| E1 HOLE | Is a foreign instance acked before it's refused? | It isn't refused at all. A session-less action from mallory@globex to `acme.eng.lead` is acked `202` and completes |
| E2 HOLE | Can a same-org member run another member's seat? | Yes. bob@acme opens and runs `acme.~alice.research`. Today a user-owned seat exists in name only |
| E5 HOLE | Does a row that names another org reload? | Yes, under the cell's org. The row's `owningOrgId: "globex"` is stripped by the schema with no problem reported |
| E8 HOLE | Does the catalog show other planes' seats? | Yes. mallory@globex sees `acme.eng.lead`, and bob@acme sees `acme.~alice.research` |
| E9 HOLDS | Can a held address be re-registered under a different config? | No. A duplicate address is refused already. Once released, though, the address takes any config, and alice's open session on it runs the new one |

## After: run against the FIX-1529 branch

`after.poc.test.ts` uses the same harness, but hires the way a hire writer does, with a pin.
It runs against a checkout of fixpoint-labs/flow-state-dev#2091 (head `01b29f0d`):

```bash
bash specs/issues/FIX-1522/poc/f2-experiments/run-after.sh /path/to/fix-1529-checkout
```

**First run, 9 passed.**

Six CLOSED legs, each refused as the plan expects:
- **E3:** a session opened before the pin existed is refused on resume after the reload pins
  the seat.
- **E7:** mallory's internal dispatch never runs the pinned seat. As a control, alice's dispatch
  does run it.
- **E1/E2:** a foreign org and a roster peer both get `404` before any ack, with a session or
  without one.
- **E6:** the pin decides, not the address. `acme.x` pinned to globex admits globex and
  refuses acme.
- **E8:** the catalog is per caller. An anonymous caller sees shared flows only, with a `200`.
- **E9:** after release and a re-hire under another pin, the old session is refused.

The fence holds on every path the plan named. Three probes found gaps outside it:

| Probe | Observed on `01b29f0d` |
|---|---|
| **A** address collision | Alice's `~alice/research` and Bob's `~bob/research` both mint `acme.research`, because a user-owned seat's address is `<org>.<seatId>` with no user in it. The reload returns both; the second is refused as "already registered". At hire time, kitchen-sink's refusal names the holder's kind (read, not run), which tells Bob that a private seat by that name exists |
| **B** private writer is readable | Any flow may declare `defineHiredRosterPrivateCollection()`, whose pattern the guard exempts. An app action in bob@acme's session listed it and read `ALICE-PRIVATE` |
| **C** the guard tests one key | `workforce/roster/[owner]/notes` is admitted, because the guard only checks whether a pattern matches `workforce/roster/~alice/research`. It still reads every user's private `notes` row |

### Second run: #2091 at `fdca49fd`, after the A/B/C fixes

**11 passed.** The six CLOSED legs still hold. Every probe now comes back closed:

| Probe | Observed on `fdca49fd` |
|---|---|
| **A** | Alice's and Bob's `research` seats mint `acme.~alice.research` and `acme.~bob.research`, pinned to each user, and both register |
| **B** | A flow may still declare the branded writer, but a run only ever sees its own user's rows. bob's list comes back empty |
| **B2** | bob asking for `~alice/research` by its exact key gets `undefined` |
| **C** | `workforce/roster/[owner]/notes` is refused when it is defined, by the structural guard |
| **B4** (note) | With debug endpoints switched on (`debugEndpointsEnabled: true`, off by default), the debug collection listing returns alice's row, instructions included, to bob's session. Debug routes read the store directly and bypass the resource handle. That is an operator-tool property, not an F2 path, but a host must not switch debug endpoints on in a multi-user deployment |

### Resource planes: R1–R3 on `fdca49fd`

Three legs give one person, alice, a hire in each of two orgs, and write one resource per
plane. **14 passed** with the suite.

| Leg | Observed |
|---|---|
| **R1** plane 1 | A user-scoped preference set under `acme.~alice.helper` reads back under `globex.~alice.helper` |
| **R2** plane 2 | An org-scoped doc written from Acme reads empty under Globex. **Control:** Acme re-reads it |
| **R3** plane 3 | A user-scoped resource with `flowIsolation: true`, written under the Acme hire, reads empty under the Globex hire and back under Acme. **Red state:** with the flag removed, the Globex hire reads the Acme note |

## Limits

- **In the before half, not run:** E6 (pin, not address) and the anonymous half of E8. Both
  need a pin to exist, so they run only in the after suite.
- **Probe A's hire-time leak is read, not run.** The kitchen-sink admin flow's "already
  served by a flow of kind …" refusal was read from `apps/kitchen-sink/flows/workforce-admin/flow.ts`.
  The address collision itself was run through the shipped reload.
- **E7 uses `internal` dispatch, not a task board's drain.** Both go through the same seam
  and child-session creation, and a board's `task` dispatch additionally needs a claimed row.
  The board form is worth a leg in FIX-1529, but it doesn't test a different door.
- **E9's "after release" case is covered by admission (e) in the plan,** not by
  registration. Once a pin exists, a session opened under the old owner won't match the new
  one.
- In-memory store only.
