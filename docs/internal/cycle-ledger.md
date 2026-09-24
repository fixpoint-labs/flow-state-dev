# Cycle ledger

Measurement instrument for the development loop, maintained by the `distill-lessons`
skill. One row per **spec, implementation, or epic** PR, derived from GitHub review data.
Epic PRs are rows in their own right — they carry a rework class their child specs
don't, and a ledger that samples only children reports zero for it.

**The metric that matters:** rounds-to-approval and the share of findings in the
top recurring class, both trending **down** across cycles. Flat or rising means the
upstream fixes landed at the wrong altitude — move them, don't add more.

**A cycle may declare a different primary axis**, and several have. When it does, the
axis and its definition are declared in that cycle's own **Method** block, which is
authoritative for that entry — check it before reading any column against another
cycle's. The definition of a *round* has changed four times across the cycles; every
change is fenced where it happens.

**Feedback classes** — the closed set. Every finding gets exactly one:
`design-off` · `missed-edge-case` · `over-engineered` · `spec-ambiguity` ·
`philosophy-drift` · `docs-miss` · `stale-restatement` · `nit`.

**Reading labels** — non-exclusive, and **never** summed into a class distribution:
`overclaim` (prose, a comment or a test asserting more than the code does) and
`vacuous-assertion` (an assertion that passes for a reason unrelated to what it claims
to check). A reading label names a *shape* that cuts across the closed set; each
observation carrying one is also counted under exactly one official class, so a reading
total and a class total describe the same findings twice and must never be added
together. Introduced cycle 11, which is also where the distinction is argued.
`vacuous-assertion` is proposed for promotion to the closed set (cycle 11, fix B) and is
a reading label until the owner rules on it.

`stale-restatement` (added cycle 2) is the document-surface sibling of
`missed-edge-case`: a decision was corrected where it is *owned* and the surfaces
that **restate** it — a table, an index, a diagram, a completion criterion — still
carry the old answer. Kept separate because the fix differs: `missed-edge-case`
wants the case handled, `stale-restatement` wants the restatements converged.

---

## Cycles

One file per cycle in [`cycle-ledger/`](cycle-ledger/). Read this index first, then open only the
cycles you need: the one you are scoring against, and any whose claims or fixes it names.
A new cycle is a new `cycle-ledger/cycle-NN.md` (next number, two digits) plus a row here;
earlier cycle files are records and are not rewritten.

| Cycle | Epic / scope | File |
|---|---|---|
| 1 | delegation substrate (2026-07) | [`cycle-01.md`](cycle-ledger/cycle-01.md) |
| 2 | durable-jobs epic-spec (2026-08) | [`cycle-02.md`](cycle-ledger/cycle-02.md) |
| 3 | epic-lifecycle coordination (2026-08, in flight) | [`cycle-03.md`](cycle-ledger/cycle-03.md) |
| 4 | durable-jobs epic wrap (FIX-939) (2026-08-11) | [`cycle-04.md`](cycle-ledger/cycle-04.md) |
| 5 | declared-surface epic wrap (FIX-1127) (2026-08-12) | [`cycle-05.md`](cycle-ledger/cycle-05.md) |
| 6 | Conductor epic wrap (LAB-68) (2026-08-18) | [`cycle-06.md`](cycle-ledger/cycle-06.md) |
| 7 | flow-instances epic wrap (FIX-1320) (2026-09-08) | [`cycle-07.md`](cycle-ledger/cycle-07.md) |
| 8 | durable-storage-symmetry epic wrap (FIX-1157) (2026-08-28) | [`cycle-08.md`](cycle-ledger/cycle-08.md) |
| 9 | default-worker-kind epic wrap (FIX-1359) (2026-09-16) | [`cycle-09.md`](cycle-ledger/cycle-09.md) |
| 10 | W3 file-convention epic, mid-flight (FIX-1351) (2026-09-16) | [`cycle-10.md`](cycle-ledger/cycle-10.md) |
| 11 | honest-task-substrate epic wrap (FIX-980) (2026-09-10) | [`cycle-11.md`](cycle-ledger/cycle-11.md) |
| 12 | W3 file-convention epic wrap (FIX-1351) (2026-09-17) | [`cycle-12.md`](cycle-ledger/cycle-12.md) |
| 13 | W3 file-convention epic, third collection (FIX-1351) (2026-09-18) | [`cycle-13.md`](cycle-ledger/cycle-13.md) |
| 14 | W4 work-routing & package-cohesion epic wrap (FIX-1407) (2026-09-20) | [`cycle-14.md`](cycle-ledger/cycle-14.md) |
| 15 | remove-superseded-leftovers epic wrap (FIX-1208) (2026-09-22) | [`cycle-15.md`](cycle-ledger/cycle-15.md) |
| 16 | workforce plane isolation epic wrap (FIX-1528) (2026-09-24) | [`cycle-16.md`](cycle-ledger/cycle-16.md) |
| 17 | W5 Workforce release QA epic wrap (FIX-1457) (2026-09-24) | [`cycle-17.md`](cycle-ledger/cycle-17.md) |
