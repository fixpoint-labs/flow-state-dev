# FIX-1507 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

No documentation impact. This moves package-internal code only: no export, prop, option,
request, error text or rendered output changes, and neither new helper is exported. The pages
that describe the navigator and the panels (`packages/react/README.md` and the component pages
under `apps/docs/docs/`) describe observable behaviour, which is unchanged, and mention no
internal read. Source file headers are updated as part of the code change ([PLAN S6](PLAN.md#surfaces)).
