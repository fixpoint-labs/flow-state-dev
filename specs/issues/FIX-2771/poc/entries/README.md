# entries · FIX-2771 POC

Retained spec evidence, not production code. Excluded from production discovery: it is a
plain `.mts` script, not a `*.test.*` file, and no workspace's test glob reaches `specs/`.

**The question.** Which of Teammates' inventory allowlist entries does this issue remove, does
every entry have exactly one owner among the three Teammates jobs (or a named "shared"), and how
many lines must the host lose to meet the 300-line configuration cap?

**Run** (from the repository root):

```bash
node specs/issues/FIX-2771/poc/entries/check.mts            # prints the 15 and the counts; exit 0
node specs/issues/FIX-2771/poc/entries/check.mts --control  # plants an entry nobody owns; exit 1
```

**What it showed (2026-11-17, `origin/main` at `e90786196b`).** 57 entries: 15 for FIX-2771,
25 for FIX-2772, 12 for FIX-2773, 5 for the last Teammates child to merge. Configuration 608 lines
(host 397, `fsdev.config.mts` 66, seven prompts 145), so the host must fit in 89. The control
exits 1 with `no owner: src/app/planted.ts · Planted · type`. See
[DECISIONS.md → Settled](../../DECISIONS.md#settled).

Ownership follows the coordinator's settlement of the Teammates seams (2026-11-17).
