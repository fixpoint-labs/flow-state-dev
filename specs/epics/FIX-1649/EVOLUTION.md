# FIX-1649 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| FIX-1477 D1: the navigator and panels ship from `@flow-state-dev/react` with no CSS framework, themed through custom properties and slots; source [`../../issues/FIX-1477/DECISIONS.md#d1`](../../issues/FIX-1477/DECISIONS.md#d1), with BR-17 in its `BUSINESS-RULES.md` | **Retained** | `--fsd-nav-*` and `--fsd-panel-*` are read in `packages/react/src/components` on `main`, and kitchen-sink's `app/page.tsx` maps its tokens onto them | This epic's D2 and ER-2 consume the contract; FIX-1655 maps one token set onto it. D1's rejection of the copy-in registry *for the chrome* also stands: the chrome is imported from `react`, and publishing `ui` as a runtime package is not reopened | No prop or property is renamed; existing hosts keep their own mapping |
| FIX-1455 D5: a component ships once, from its one package; Labs import it, never copy it; no third Workforce UI package; source [`../FIX-1455/DECISIONS.md#d5`](../FIX-1455/DECISIONS.md#d5) | **Retained** | shift-manager imports the react chrome and takes generic rendering from the `ui` registry by `fsdev ui add`, the route D5 already gives kitchen-sink; the design-system package holds the shift-manager theme, not Workforce UI | ER-6 (unedited copies, re-synced), ER-7 | None: [D3](DECISIONS.md#d3) chose one app, so no chrome package amends D5 |
| FIX-1455 D3: seat, kind and agent, and none of them L1; source [`../FIX-1455/DECISIONS.md#d3`](../FIX-1455/DECISIONS.md#d3) | **Retained** | The Architect's vocabulary on FIX-1649 restates it | ER-7, ER-8 | None |
| D-12: Conductor retired, DevTeam is a Lab built completely on Workforce; provenance [FIX-1410](https://linear.app/fixpoint-labs/issue/FIX-1410) (Done), restated on FIX-1649 | **Retained** | `labs/conductor` remains in the repo as incubation; this epic revives no factory shell around it | ER-8; [D3](DECISIONS.md#d3) reads "a Lab" as a Workforce tree | `labs/conductor` is untouched |

No predecessor is superseded. Kitchen-sink's shell (FIX-1455, FIX-1592) stays the teach
surface; shift-manager is beside it, not in place of it. Re-check each cited intention against
current code before implementing.
