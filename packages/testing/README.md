# @flow-state-dev/testing

Testing utilities package for Flow State Dev.

## Current Status

This package is currently scaffolded and exported in the workspace, with implementation of canonical testing utilities still in progress.

Current export:
- `testingPackageMarker`

## Intended Scope

This package will own framework testing helpers such as:
- deterministic block/flow test harness utilities
- item assertion helpers
- snapshot trace helpers
- generator mocking helpers

These contracts are defined in `preperation/architecture/TESTING.md` (sibling repository to `implementation/`).

## Scripts

- `pnpm --filter @flow-state-dev/testing build`
- `pnpm --filter @flow-state-dev/testing typecheck`
- `pnpm --filter @flow-state-dev/testing test`

## Notes

- Keep this package independent of app-specific test code.
- Prefer framework-contract tests that mirror canonical runtime semantics.
