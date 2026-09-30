# FIX-1456 · Docs

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

Two small page edits and the changeset. No package README states the skill-name rule. Each edit
is a sentence, so neither needs a `docs-writer` pass.

## 1. `apps/docs/docs/workforce/workers-on-disk.md`, "Names in the tree"

Delete the paragraph that begins "That last refusal covers every name above except a **skill**
folder." The paragraph before it already lists skills among the names the rule covers, and with
this change that statement is true.

## 2. `apps/docs/docs/skills/authoring.md` (line 20)

After the sentence that states the name rule, add:

> Windows device names (`con`, `prn`, `aux`, `nul`, `com1` through `com9`, `lpt1` through
> `lpt9`) are refused too, because a folder with one of those names can't be checked out on
> Windows.

## 3. Changeset

`@flow-state-dev/orchestration: patch`. Skill names that are Windows device names are now
refused, so a skill with one of those names stops loading. Rename it to load it again.
