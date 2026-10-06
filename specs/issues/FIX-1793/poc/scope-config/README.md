# POC · one project row at two scopes, and a workstream entry on today's engine

Evidence for [FIX-1793](../../SPEC.md)'s [D1](../../DECISIONS.md#d1) and its owner rule. Not
production code: nothing imports it, it has no package manifest, and it is outside default
build, test, lint and knip discovery ([specs/README.md](../../../../README.md)). Throwaway.

## The questions

1. **Are private projects mostly a scope configuration?** Can one flow declare the same row at
   org scope and at user scope, keep them apart, and serve each to the browser? If not, a
   private project needs its own pattern or a field, and costs more than the epic's condition
   allows ([epic Q2](../../../../epics/FIX-1786/DECISIONS.md#q2)).
2. **What does a private project need from FIX-1790?**
3. **Does today's engine already give a row one user writes and the org reads?** If one of its
   shapes does, the epic's second Layer 1 change isn't needed.

## How to run it

```bash
pnpm install          # once per checkout
bash specs/issues/FIX-1793/poc/scope-config/run.sh
```

It runs on the real engine: `createFlowState` with in-memory stores, the real `/api/flows`
router for session creates and the browser's resource reads, and `runAction` for admitted
requests. Two verified headers stand in for a real sign-in. Nothing in the scope or store layer
is stubbed.

## What was observed

On `39d7abe13`: **8 passed**. Each assertion pins what is true today, so an engine change shows
up here as a red test.

| Leg | Question | Observed |
|---|---|---|
| S1 | Does one flow take `projects/*` at org scope and at user scope? | Yes: the build-time collision check keys by scope, so the two are different cells |
| S2 | Alice makes a shared and a private `apollo` | Both land and read back apart |
| S3 | Bob reads the shared one, and Alice's private one? | The shared one, yes. Alice's private one reads as absent and lists empty. Bob's own private `hermes` doesn't touch Alice's |
| S4 | The browser's resource route, by accessor | Each accessor is served apart. Alice's read shows her private row; Bob's read of the same accessor doesn't |
| O1 | Alice in a second org reads her private project | **Yes, today.** User scope is one cell across orgs. FIX-1790 closes it; when it lands, this leg goes red on purpose |
| G1 | A plain org collection for entries | Bob reads Alice's entry **and overwrites it**. Too weak |
| G2 | An owner-private org collection for entries | Bob can't overwrite Alice's entry, **and can't read it either**. Too strong |
| G3 | The same, from the browser | Refused: an owner-private collection has no browser read, so the app can't list entries |

## What it means

- **D1's premise holds.** A private project is the same row declared at user scope: no new
  pattern, no field, a browser read each. The cost is the declarations, the create option and
  reading two lists.
- **Private projects wait on FIX-1790** (O1), as the epic's order already has it.
- **Neither existing shape is the owner rule** (G1, G2, G3). The rule is new engine work, as the
  epic's D3 says, and the owner-key fence G2 uses is where it fits: it already reads the owner
  off the key.
