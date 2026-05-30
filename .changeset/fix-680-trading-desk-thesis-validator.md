---
---

FIX-680: Add a Phase 6 thesis-alignment audit to the private `@flow-state-dev/example-trading-desk` example. Users can enter their own thesis before a run; the pipeline analyzes the ticker blind to it, then a post-decision validator surfaces where the evidence supports, contradicts, or overlooked the thesis. No publishable package surface changes.
