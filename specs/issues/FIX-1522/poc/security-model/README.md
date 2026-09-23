# POC · the multitenancy model

An experiment retained as evidence for [FIX-1522](../../SECURITY-MODEL.md). Not production code:
nothing imports it, it has no package manifest, and it is outside default build, test, lint and
knip discovery ([specs/README.md](../../../../README.md)).

## What it checks

How users, orgs, sessions, storage cells and flow instances relate, and which boundary each one
enforces. It uses the real `/api/flows` router with a verified principal
(`x-verified-user` / `x-verified-org`, standing in for a real verifier) set at both the flow and
the host level. Nothing is stubbed.

## How to run it

```bash
pnpm install          # once per checkout
bash specs/issues/FIX-1522/poc/security-model/run.sh
```

## What was observed

Run on this branch (based on `d8d4c26`): **11 passed**.

| Leg | Question | Observed |
|---|---|---|
| M1 | Many users per org? | bob reads the org note alice wrote |
| M2 | Many orgs per user? | alice holds a session in `acme` and one in `globex`, each reading only its own org's notes |
| M3 | Is a session pinned? | alice-in-globex reading her acme session: `403 Caller's organization does not own the requested resource`. Acting in it: `202`, then refused, nothing written. bob: `403` |
| M4 | Are listings scoped? | `GET /sessions` returns only the caller's session in the org they are acting for |
| S1 | Org cells separate orgs? | acme's note is in `("org","acme")` only; mallory in globex reads none |
| S2 | User cells separate orgs? | **no**: alice-in-globex reads the note she wrote as alice-in-acme |
| F1 | One set of flows? | the catalog is identical for acme and globex callers and lists both orgs' seats |
| F2 | **CROSS-ORG**: can another org run an org's seat? | mallory@globex opens a session on `acme.eng.lead`, runs it, and the run records acme's instructions: `ACME-CONFIDENTIAL: you work on acme's roadmap` |
| F3 | Does that reach the seat's org's data? | no: it reads and writes globex's cells, and acme's stay untouched |
| T1 | What does the tenant header separate? | sessions only (`404` across tenants). A new session under `t2` reads the org and user notes written under `t1` |
| U1 | With no verifier? | a self-named `stranger` reads alice's org note, because every caller is in one org |

## Limits

- F2 proves the **instructions** travel. The model and tool catalog are taken from the same
  `ctx.flow.config` in `packages/workforce/src/agent-worker-flow.ts:757–770`; that was read, not
  run. No generator runs here.
- F2 has no red state to show, because there is no gate to switch off. The engine has no
  instance-to-org binding. The evidence is the recorded instructions string, which can only have
  come from acme's instance config.
- In-memory store only. Storage keying is shared across adapters, but no adapter was run.
