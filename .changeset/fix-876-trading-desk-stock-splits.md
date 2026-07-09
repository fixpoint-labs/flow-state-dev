---
---

FIX-876: Teach the private `@flow-state-dev/trading-desk` example's ledger about stock splits. A split is now a first-class `split` event (numerator/denominator) that FIFO derivation honors by rebasing open lots (quantity × ratio, basis ÷ ratio, acquisition date preserved), forward and reverse; the OFX importer ingests `SPLIT` instead of skipping it; a "Split" type is available in the add-transaction dialog; transaction import gains an atomic "reset account" mode behind a typed `REPLACE` confirmation; and a ticker that over-sells everything it ever held (an unaccounted corporate action) now materializes as a flagged, visible `inconsistent_history` holdings row rather than being silently deleted. No publishable package surface changes — the example package is private.
