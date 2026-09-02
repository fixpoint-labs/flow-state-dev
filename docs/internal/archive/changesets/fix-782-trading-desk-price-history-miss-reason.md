---
---

Trading Desk: when a report in the private `@flow-state-dev/trading-desk` example
ends up without a price chart, the run now says why. The step that saves a
finished report's price series used to return silently when it found nothing to
save, so a report whose Summary fell back to a plain trade-levels list looked
exactly like one whose data provider genuinely had no prices — the difference was
only recoverable by re-running the analysis. It now writes a reason line naming
the ticker and what was missing, so a chartless report is diagnosable from the
run's trace. A genuine provider gap is unchanged and still distinct: it produces
an empty series that is saved with its provenance and shown as an honest gap, not
reported as a fault. Internal-only — no publishable package surface changes.
