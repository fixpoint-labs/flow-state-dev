# POC · principal alignment

Tests whether the pentest lab can drop its body-`orgId` wrap and still run as `org_pentest_lab`
by setting a host-level `resolvePrincipal`, with no framework change.

`host.patch` is a throwaway diff against `goals/pentest-lab/lab/host.mts` at `main` `7dd56cd74`.
It adds the resolver, removes the wrap, and sends BR-16's org-less probe to `runAction`. It keeps
the old option name `omitOrgWrap` so that the existing `GOAL_CONTROL=no-org-wrap` drives the new
control. Nothing discovers or imports this directory.

```bash
git apply specs/issues/FIX-1443/poc/principal-alignment/host.patch
pnpm tsx goals/pentest-lab/a-post-reaches-both-declared-seats/run.mts                          # PASS
GOAL_CONTROL=no-org-wrap pnpm tsx goals/pentest-lab/a-post-reaches-both-declared-seats/run.mts # FAIL: bound to org __fsd_default_org__ …
pnpm tsx goals/pentest-lab/a-seat-answers-from-its-own-document/run.mts                        # PASS (AI_GATEWAY_API_KEY)
git apply -R specs/issues/FIX-1443/poc/principal-alignment/host.patch
```

**Result:** all three came out as the comments above say. The sibling passed on 2 of 3 runs. The
third run's fan-out never settled, and it recovered on a re-run with nothing changed. Unpatched
`main` fails both checks at the first channel read.
