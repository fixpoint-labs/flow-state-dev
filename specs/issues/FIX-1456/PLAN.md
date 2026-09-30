# FIX-1456 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md)

## Surface

- `packages/orchestration/src/skills/skill-md.ts`: add the device set and the check in
  `validateSkillName`, after the `RESERVED_NAMES` check.
- `packages/orchestration/test/skills/skill-md.test.ts`: the BR-1 and BR-2 cases.
- `packages/orchestration/test/skills/read-directory.test.ts`: the BR-3 case.
- `packages/workforce/src/loader/segments.ts`: the comment only (E5).
- `apps/docs/docs/workforce/workers-on-disk.md` and `apps/docs/docs/skills/authoring.md`, as
  set out in [DOCS.md](DOCS.md).
- `.changeset/*.md`: a `patch` for `@flow-state-dev/orchestration`. Consumers need to know,
  because a skill of theirs with a device name will stop loading (BP-022).

## Order

1. Write the BR-1 and BR-2 tests, and watch BR-1 fail on `main`.
2. Add the check, and watch the tests pass.
3. Add the BR-3 test, the comment, the docs and the changeset.

## Checks

```bash
pnpm --filter @flow-state-dev/orchestration test -- skills
pnpm --filter @flow-state-dev/orchestration typecheck
git diff main... -- packages/orchestration/src | grep -E '^\+.*from "@flow-state-dev/(workforce|engine)'  # prints nothing
```

**Red state:** on `main`, `validateSkillName("con")` doesn't throw, so the BR-1 test fails.

## Guardrails

- Don't import from `workforce` or `engine`, and don't add a shared module. FIX-1428 owns the
  dedupe.
- Leave the other differences between `validateSkillName` and `validateSegment` alone.
- Keep the 1–9 bound (E2).

## Notes from review

None yet.
