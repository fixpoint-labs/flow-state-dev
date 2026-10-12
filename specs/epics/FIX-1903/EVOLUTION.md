# FIX-1903 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

Only lineage that spans children. Each child records its own specifics.

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| A project's repository is a remote, never a folder on some machine; [`../../issues/FIX-1762/BUSINESS-RULES.md`](../../issues/FIX-1762/BUSINESS-RULES.md) BR-5, enforced by `packages/workforce/src/projects/repository-value.ts` | **Retained** | D3 keeps the row a remote and puts the machine's checkout in host config | ER-3, ER-11; FIX-1906 owns | No row changes shape |
| A repository project's run keeps the project's files in `project/` beside `checkout/`, never inside; FIX-1762 BR-28 | **Retained**, and extended to a local checkout | The local-repository mode in `packages/workspace/src/local-host.ts` refuses kept files beside the checkout today ("a source may not name kept files beside it") | ER-3; FIX-1906 owns | A fixed `sourceRepo` app (FIX-1762 BR-22) keeps today's behaviour |
| DevTeam's profile is what `shift-manager start` and `dev` open with no `--config`; `packages/shift-manager/scripts/checkout.mts` | **Amended** | D2: five goal checks need DevTeam unedited, and a dev Lab needs only the two dev projects | The dev profile is the default; DevTeam by `--config`; FIX-1904 owns | Any script that relied on the default passes `--config` with DevTeam's file |
| A served Lab never falls back to the scripted coder silently; `packages/shift-manager/teams/devteam/harness.mts`, `selectHarness` | **Retained** | Q1's recommendation keeps it: no credential refuses the start | ER-2; FIX-1904 owns | DevTeam's default stays the scripted coder |
| The Claude Code harness takes no MCP option, so a conductor-owned ask tool was refused as widening the framework; `packages/harness-manager/src/ask.ts` header, citing LAB-138's decision 3 (an incubation lab; no retained source) | **Amended** for MCP, retained for the ask | D4 adds a generic per-run MCP pass-through, which the Agent SDK already supports. It is not a conductor-owned tool, and the ask stays a file | ER-9; FIX-1905 owns; its spec rechecks the lab decision | Absent option means no servers, as today |
| A project's coding work was to get MCP servers from the coordinator that hands it over; FIX-1903's and FIX-1905's Linear descriptions | **Superseded** | A run started from Inbox or by the chief of staff passes through no coordinator; the run's own task row names its project on every path | D4, ER-5, ER-8 | Nothing built yet |

Nothing from [FIX-1870](../FIX-1870/SPEC.md) is changed: its hand-over tools are left alone
(ER-8). Re-check the cited intentions against current code before implementing.
