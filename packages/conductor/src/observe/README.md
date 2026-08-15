# observe

Conductor's other seam: **how the world gets read.** One interface, `Observer` — hand it
the entity and the cursor from last time, get back the `World` snapshot `decide` reduces
against, the signals since the previous observation, and the cursor to persist for the
next one.

It mirrors [`../dispatch`](../dispatch), the seam for how work gets done. The tick sits
between the two:

```
Observer.observe() ──▶ { world, signals } ──▶ decide() ──▶ Action[] ──▶ Dispatcher.run()
```

Types only. The implementations live next to their I/O and are interchangeable:
[`../github`](../github) reads the GitHub API, [`../local`](../local) reads a real git
checkout. Neither is importable from here, which is what keeps source-shaped detail out of
the seam.

- **An observer materializes; it never decides.** This is the one I/O half of a tick,
  which is what lets `decide` stay pure and synchronous.
- **It reads what the phase declared.** A snapshot is filled from the facts a phase's
  gates say they read. Reading more is over-fetching, which is bounded and accepted;
  reading less hands a gate a default and kills its behaviour quietly.
- **The cursor round-trips verbatim.** Conductor stores it and hands it back untouched. It
  is the only thing a dropped event can be detected against, which is what makes polling
  authoritative rather than best-effort.
- **A source can say which submission is on a branch.** `submissionForBranch` is the
  seam's second method and it is a lookup, not a materialization: `observe` reads the
  submissions an entity's artifacts already name, which is no help before the first one
  exists. Conductor names the branch its work goes on; something else opens the pull
  request for it, and neither an agent's own account of its run nor a human's PR is
  something a vendor result can be trusted to report. One question answers both.

How a source *learned* that something changed — a webhook, a poll, a file watcher — is
deliberately absent from the seam. `reconcile` turns any source's fresh facts into the
same signals.
