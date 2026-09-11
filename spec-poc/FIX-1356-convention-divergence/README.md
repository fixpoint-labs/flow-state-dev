# FIX-1356 — characterization POC

Throwaway. Lives on the spec branch, never merges. It exists so the spec's factual
claims can be **run** rather than read, because the recommendation rests on them.

Two suites, both pure characterization: every assertion describes `main` as it is
today. Neither proposes anything.

| File | Question it answers |
|---|---|
| `packages/orchestration/test/_fix1356/characterize.test.ts` | How does the shipped `readSkillsDirectory` actually differ from the worker/room shape? |
| `packages/workforce/test/_fix1356/passthrough.test.ts` | Does a `WORKER.md` that declares `skills:` already reach its hired seat? |

They sit in the packages' own `test/` folders (rather than under this one) so they run
with the ordinary command and no extra config. The `_` prefix marks them throwaway.

## Run them

```bash
pnpm install
pnpm --filter @flow-state-dev/orchestration exec vitest run test/_fix1356
pnpm --filter @flow-state-dev/workforce exec vitest run test/_fix1356
```

Expected: 7 passing in orchestration, 3 in workforce. Each logs what it observed, so
the output is the evidence — read the `stdout` blocks, not just the green.

## What they found

- The skills reader walks a **flat** tree. Pointed at a workforce root it does not find
  `teams/<id>/skills/<name>/SKILL.md`, and it misreports `teams/` as a broken skill
  (`Missing SKILL.md in "teams/"`).
- Its per-entry errors are keyed by bare `name`; there is no `path`.
- A `SKILL.md` that **exists but cannot be read** is reported as `Missing SKILL.md` —
  present-but-broken is collapsed into absent. This is the one genuine defect.
- Skill identity is a bare folder name, and the shipped name validator **refuses** the
  dot-joined `pentest.recon` form the sibling conventions mint.
- A `WORKER.md` declaring `skills: [port-scan, triage]` already loads and hires, arriving
  at the seat as `{"instructions":"Find things.","skills":["port-scan","triage"]}`.

See the spec's §7 and §10 for what follows from that.
