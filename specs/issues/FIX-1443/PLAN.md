# FIX-1443 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md)

## Surface

- `goals/pentest-lab/lab/host.mts`:
  - `createFlowState` gets `resolvePrincipal` unless `options.omitPrincipal` is set (D1).
  - The two wrap lines go. `CreateSessionOptions`'s "the wrap" doc comment and the session
    client's doc comment are rewritten (DOCS §3).
  - `OpenLabOptions.omitOrgWrap` becomes `omitPrincipal` (E2).
  - `inspect`'s `omitOrg` branch calls `act(seat, "inspect", {}, "no-org-<seat>", { omitOrg: true })`
    instead of the HTTP route. Its comment says why: the router can no longer see an org-less
    request (D3).
  - The file header's "fifth thing" paragraph is rewritten (DOCS §3).
- `goals/pentest-lab/a-post-reaches-both-declared-seats/run.mts`: the control case
  `no-org-wrap` becomes `no-principal-org` and returns `{ omitPrincipal: true }`. Update the
  control list text if it names the control. The line-513 comment mentions `openChannels`; leave
  it unless it describes the wrap.
- `goals/pentest-lab/a-post-reaches-both-declared-seats/goal.md`: see DOCS §2.
- `goals/pentest-lab/lab/README.md`: see DOCS §1.
- `goals/devforce-lab/lab/host.mts`: the one sentence about the pentest lab (E3).

## Order

1. On `main`, run the gate and watch it fail at the channel read. That is the red state.
2. Apply the host change. The POC patch is the shape. Run the gate (PASS) and the control (FAIL).
3. Rename the control and move the BR-16 probe. Re-run both.
4. Docs and comments. Run the BR-5 grep.
5. Run the model-backed sibling. If a run fails with the fan-out unsettled and 0 lines, re-run
   once before treating it as a wiring failure (DECISIONS → Settled).
6. Add one verdict-log row per check to `goal.md`, with the commit and results.

## Checks

```bash
pnpm tsx goals/pentest-lab/a-post-reaches-both-declared-seats/run.mts                               # PASS
GOAL_CONTROL=no-principal-org pnpm tsx goals/pentest-lab/a-post-reaches-both-declared-seats/run.mts # FAIL, names the org mismatch
GOAL_CONTROL=list pnpm tsx goals/pentest-lab/a-post-reaches-both-declared-seats/run.mts             # lists no-principal-org, not no-org-wrap
pnpm tsx goals/pentest-lab/a-seat-answers-from-its-own-document/run.mts                             # PASS (AI_GATEWAY_API_KEY)
grep -rnE "omitOrgWrap|no-org-wrap|FIX-1412|the wrap" goals/pentest-lab goals/devforce-lab          # only dated verdict-log rows
```

**Red state:** on `main` at `7dd56cd74`, the first command fails with *"Session pentest.findings is
bound to org `__fsd_default_org__` but request supplied org `org_pentest_lab`."*

## Guardrails

- Don't pass `orgId` to `openChannels`, and don't put it back in a session-create body. Both are
  what this issue removes.
- Don't touch `packages/`. If the lab can't go green without a framework change, stop and raise
  it. Don't widen the change.
- Keep opening channels through the HTTP session routes. The gate's Signal says it does.
- Leave the other eleven controls alone. `reverse-order` must stay green.
- Don't rewrite historic verdict-log rows. Add new ones.

## Notes from review

None yet.
