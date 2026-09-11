# FIX-1356 — characterization POC

Throwaway. Lives on the spec branch, never merges, and is **deleted** at the start of
implementation rather than graduated — it pins behaviour this issue changes, so keeping it
would pin the bug as the contract (spec §10).

It exists so the spec's load-bearing claims can be **run** rather than read. Scoped to the
claims the "ratify, don't align" fork actually rests on; behaviour the spec marks as already
agreeing with the sibling conventions is covered by the packages' own suites and is not
re-pinned here.

| File | Question it answers |
|---|---|
| `packages/orchestration/test/_fix1356/characterize.test.ts` | How does the shipped `readSkillsDirectory` differ from the worker/room shape; what happens when one skill name is declared twice; and can frontmatter displace a field the reader derives? |
| `packages/workforce/test/_fix1356/passthrough.test.ts` | Does a `WORKER.md` that declares `skills:` already reach its hired seat? |

They sit in the packages' own `test/` folders so they run with the ordinary command and no
extra config. The `_` prefix marks them throwaway.

## Run them

```bash
pnpm install
pnpm --filter @flow-state-dev/orchestration exec vitest run test/_fix1356   # 8 passed
pnpm --filter @flow-state-dev/workforce exec vitest run test/_fix1356       # 2 passed
```

Add `FIX1356_LOG=1` to print what each case observed — the logs are the evidence, and are
silent otherwise so the suites stay quiet in an ordinary run.

**Findings live in the spec's §10 table**, which is the single evidence surface; they are
deliberately not restated here. One of them (`C1`) corrected a claim an earlier draft had
read from the source rather than run.
