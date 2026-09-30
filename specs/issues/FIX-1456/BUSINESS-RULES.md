# FIX-1456 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A skill is named `con`, `prn`, `aux`, `nul`, `com1`–`com9` or `lpt1`–`lpt9` | `validateSkillName` throws, and the message says it's a reserved device name on Windows | New cases in `packages/orchestration/test/skills/skill-md.test.ts` |
| BR-2 | A skill is named `com0`, `lpt0` or `console` | It is accepted | The same test |
| BR-3 | A skills folder holds a subfolder called `nul` | `readSkillsDirectory` reports it in `errors` and still loads the others | A new case in `packages/orchestration/test/skills/read-directory.test.ts` |
| BR-4 | The PR lands | `orchestration` imports nothing new from `workforce` or `engine` for this | The import grep in [PLAN → Checks](PLAN.md#checks) prints nothing |
| BR-5 | A reader opens "Names in the tree" or the skills authoring page | Neither page says skills are an exception to the device-name rule | [DOCS.md](DOCS.md) |
