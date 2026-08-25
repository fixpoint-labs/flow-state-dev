---
---

Internal (process docs): a spec's Size is now a count, and a review that keeps finding new defects in one mechanism is now a settlement trigger. No package code changed.

- **Size is a count, not an adjective** (`spec-template.md` §6). Written last, as production files (§8) · test behaviours (§10) · doc surfaces (§11) · PRs. FIX-1000's spec said "Size: Small"; the change shipped 168 lines of production code, 1,875 lines of tests and 85 of docs — and its own §10 had specified every one of those tests. The estimate was accurate for the only thing it counted and silent on 92% of the work.
- **A loop also counts when each round finds a *new* defect in the same mechanism** (`settle-claim`, and the "When it fires" list in `orchestration.md`). The existing trigger — one claim argued twice — never fired across nine review rounds on FIX-1001's PR, because each round faulted the previous round's fix rather than re-arguing one claim. A five-writer ordering problem was being settled in prose. Stop revising and run it.
