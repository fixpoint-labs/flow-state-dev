# FIX-1435 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

None of the predecessors has a retained spec directory. They predate retention, so each is cited
by its Linear issue and the in-code record that carries its decision.

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| FIX-1389: the shared walk stops at the team folder, because "the readers share: they agree exactly down to the team folder and diverge immediately after it". Source: [FIX-1389](https://linear.app/fixpoint-labs/issue/FIX-1389), and the `walkTeams` doc comment in `packages/workforce/src/loader/structural-directory.ts` | **Amended, for the two resources doors only.** Retained for every other reader and for `walkTeams` itself | The two resources doors do not diverge after the team folder. They descend identically to the workers' `resources/` slots, at matching helper names (Jake's reading on this issue) | [D1](DECISIONS.md#d1) and E1/E4: a resources walk built on `walkTeams` | `walkTeams` is unchanged, so every other caller is unaffected |
| FIX-1354 / FIX-1368: Door A reads four places through one private walk shared by `resources/` and `references/`. Source: [FIX-1354](https://linear.app/fixpoint-labs/issue/FIX-1354), and `read-resources-directory.ts`'s header, "One walk, two slots" | **Retained.** The walk moves out of the file. It still serves both slots | E1: the walk yields places, not slot folders | S1/S2 | Same records, order and refusals (BR-6, BR-11) |
| FIX-1388: Door B is "a separate reader over the shared walk primitives, not a parameter on the Markdown one". Source: [FIX-1388](https://linear.app/fixpoint-labs/issue/FIX-1388), and `discover-resource-modules.ts`'s header | **Retained**, and one level extended. It's still a separate reader, now over one more shared primitive | The fence: one walk, two door bodies | S1/S3 | Same modules, sorted order and messages (BR-7, BR-9) |

No predecessor is superseded. FIX-1357 (the bundler-safe scan) and FIX-1394/FIX-1407 (package
cohesion) are related, not replaced.
