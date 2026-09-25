# FIX-1589 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| `desk-clerk`'s `answer` runs `desk-note` and hands the note back under the desk tag, no model. Source: `apps/kitchen-sink/workforce/flows/workers/desk-clerk.ts`, shipped by FIX-1476 ([#2007](https://github.com/fixpoint-labs/flow-state-dev/pull/2007)); marked superseded for this action by [epic FIX-1592 EVOLUTION](../../epics/FIX-1592/EVOLUTION.md) | **Superseded** for `answer`; the desk tag **retained** | FIX-1585 makes the clerk reachable; a parrot looks like a working agent. [poc Q1](poc/clerk-premises/README.md) | [D1](DECISIONS.md#d1), [D3](DECISIONS.md#d3) | Action name and input `{ note }` unchanged, so FIX-1585 D3's map and the CLI call hold. The call now needs a model |
| `desk-note` is reachable two ways, the clerk's action and a seat's tool. Source: `apps/kitchen-sink/workforce/blocks/desk-note.ts` header | **Amended**: tool only | The clerk no longer runs it | S3 in [PLAN.md](PLAN.md) | `support.otto`'s tool is unchanged |
| The files-alone goal grades each seat's desk in its answer, with no model. Source: [`code-comes-from-files-alone/goal.md`](../../../goals/workforce-conventions/code-comes-from-files-alone/goal.md), **Model** and **Signal** | **Amended**: runs on the scripted model; grading retained | The answer now calls a model; the tag is still the kind's ([D3](DECISIONS.md#d3)) | S7 | Old verdict rows stay; a new row records the switch |
| The durable-hire goal grades a hired seat's desk token in its answer, with no model. Source: [`durable-hire-survives-redeploy/goal.md`](../../../goals/workforce-conventions/durable-hire-survives-redeploy/goal.md), **Model**, legs 0 and 3 | **Amended**, as above | Same | S7 | Same |
| What the clerk's reply says is a follow-on. Source: [FIX-1585 BR-14](../FIX-1585/BUSINESS-RULES.md#asking-a-seat) | **Retained**, and answered here | — | [BR-1](BUSINESS-RULES.md#asking-the-clerk) | FIX-1585's V5 still sends `{ note }` to `answer` |
| `escalations` ships unattended so the boot warning shows. Source: [FIX-1476 D3](../FIX-1476/DECISIONS.md#d3) | **Retained** | Filing is not attending; the kind declares no board ([poc Q4](poc/clerk-premises/README.md)) | — | The warning text is unchanged |

Re-check each source against current code before implementing.
