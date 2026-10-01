# FIX-1443 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | The gate runs with no control | All ten legs pass, with the channel session and every seat action bound to `org_pentest_lab` | `pnpm tsx goals/pentest-lab/a-post-reaches-both-declared-seats/run.mts` → PASS |
| BR-2 | `GOAL_CONTROL=no-principal-org` | The gate fails on the first channel read or post, naming the development org against `org_pentest_lab` | The same command with the control → FAIL, with that message |
| BR-3 | The model-backed sibling runs with an inference key | It passes, driving the same `host.mts` | `pnpm tsx goals/pentest-lab/a-seat-answers-from-its-own-document/run.mts` → PASS; a run whose fan-out never settles with 0 transcript lines is re-run once before it counts as a failure (the POC saw 2 of 3, [Settled](DECISIONS.md#settled)) |
| BR-4 | The gate's BR-16 leg sends `inspect` with no org | It is refused `OrgRequired`, and the same read with the org lands | Leg (e) of the gate, inside BR-1's run |
| BR-5 | Someone reads the lab | Nothing adds `orgId` to a session-create body, and no text says `openChannels` can't carry an org or that FIX-1412 is open | `grep -rnE "omitOrgWrap\|no-org-wrap\|FIX-1412\|the wrap" goals/pentest-lab goals/devteam-lab` prints only dated verdict-log rows |
| BR-6 | The PR lands | No file outside `goals/` and `specs/issues/FIX-1443/` changes | `git diff --stat main...` |
