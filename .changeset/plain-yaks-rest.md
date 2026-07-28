---
---

Internal: consolidate the five duplicated `buildExecCtx` mock-context builders in
`packages/orchestration/test/skills` onto the existing shared
`test/skills/delegation-ctx.ts` fixture. Test-only; no runtime change.
