# FIX-1503 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| FIX-23 shipped `resolvePrincipal` as the host-owned verify hook; source Linear [FIX-23](https://linear.app/fixpoint-labs/issue/FIX-23), impl [PR #198](https://github.com/fixpoint-labs/flow-state-dev/pull/198) | **Retained** | The mint is an issue/sign sibling, not a replacement resolver. Hosts still write resolvers; the default one changes | This epic ER-1; engine child owns the mint + default | Existing custom resolvers keep working. The branded body-`userId` resolver remains as an explicit escape |
| FIX-1442 made org principal-owned and locked "FSD does not provide login"; source [PR #1899](https://github.com/fixpoint-labs/flow-state-dev/pull/1899) spec, [PR #1985](https://github.com/fixpoint-labs/flow-state-dev/pull/1985) impl, Linear [FIX-1442](https://linear.app/fixpoint-labs/issue/FIX-1442). No retained `specs/issues/FIX-1442/` on `main` as of 2026-09-22 | **Retained** | This epic is the identity axis beside that org axis. Reopening org cutover or `__fsd_default_org__` is [ER-12](BUSINESS-RULES.md) | [Settled](DECISIONS.md#settled) mint practice; [D3](DECISIONS.md#d3) host-asserted `org` | No stored-data migration in this epic; FIX-1442's upgrade path stands |
| `docs/architecture/authentication.md` (main `98a82a00e`) makes enforcement off when the host resolver is the framework default, and lists `list_flows` / `capabilities` as `exempt` | **Amended** | Owner direction: every URL authenticated except mint. Those two exemptions are the real holes | [D2](DECISIONS.md#d2); engine child updates the contract table | Dual-read the escape ([BP-030](../../../docs/contributing/best-practices.md)). In-process `runAction` is unchanged |
| FIX-906 asked to enforce `resolvePrincipal` on all inbound flow routes; source Linear [FIX-906](https://linear.app/fixpoint-labs/issue/FIX-906) (retitled 2026-09-21) | **Superseded** for default-posture / `list_flows` / `capabilities`; **retained** as thin leftover for session/resource/read + host parity | Two competing gate-the-surface epics was the invent-kill. Linear already parented the leftover | Engine child owns the absorbed slice; FIX-906 keeps leftover outcomes | No dual-track. `transcribe` ignoring `ctx.principal` stays on the leftover |

Neither FIX-1486 nor FIX-1477 is superseded. This epic enables the first and dissolves
openness pressure on the second. Child-specific mint path spelling belongs in the engine
issue's evolution record, not here. Re-check the cited architecture table against current
`route-auth.ts` before implementing — [PR #1223](https://github.com/fixpoint-labs/flow-state-dev/pull/1223)
also edits that file.
