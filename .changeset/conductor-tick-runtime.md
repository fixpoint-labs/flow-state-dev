---
---

Internal: adds the tick runtime to `@flow-state-dev/conductor` (private,
unpublished). `openConductor({ config, statePath })` returns a session with
`manage`, `tick` and `read`: a tick reads the world through the observer seam,
reduces every signal it reports through `decide`, provisions and runs the phase
work the actions call for, and appends the ledger. The collections declared in
the entity model are now registered against durable state under `statePath`, at
the scope each one declares — the registry at the org, the entity graph at the
lineage root, each entity's working record at its own session.

Three properties hold and are covered by tests against a real git checkout: a
tick against an unchanged world appends no ledger row and performs no dispatch;
re-opening over the same `statePath` loses no gate, moves no phase and repeats
no dispatch; and every ledger row replays to the action it records when `decide`
is re-run from the row's own arguments. No published API surface changes.
