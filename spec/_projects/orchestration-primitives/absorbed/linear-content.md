<!-- Verbatim snapshot. Do not edit, reflow, or fold. -->

# Linear project `content`, as read

**Read** 2026-10-11 from the Linear project
[Orchestration Primitives](https://linear.app/fixpoint-labs/project/orchestration-primitives-a95cf87d3400)
· project `updatedAt` **2026-08-21T19:08:45.742Z** · summary: *Unified work-unit abstraction across every multi-agent pattern.*

This is the project's own `content` field exactly as it stood when the project-spec was first
built from it. It exists so every "folded in" and "dropped as stale" call made against it stays
reversible by someone who disagrees later, and so the field can be restored if a mirror write goes
wrong.

---8<--- verbatim below this line ---8<---

Establish a single coherent work-unit abstraction across every multi-agent pattern in FSD: a **Task** shape stored in a **TaskCollection** resource, operated on by **Patterns** that bind a dispatcher × worker × loop configuration.

Every pattern that today invents its own task storage, status vocabulary, and lifecycle is rewritten on top of this primitive — or revealed to be a configuration of the new Task Board pattern and consolidated.

## What this enables

* **One mental model for tasks across the framework.** Plan & Execute, Supervisor, Coordinator, True Plan Mode, and skill-driven orchestration all use the same Task / TaskCollection / Pattern primitive.
* **Skills as a pattern surface.** Skills declare a TaskCollection seed + worker registry + chosen pattern, in `SKILL.md` frontmatter. The skill becomes the user-facing way to spawn a configured team.
* **HITL collaborative planning** as a real surface: True Plan Mode (<issue id="5bbb6e5a-6adc-4857-a032-54920fe32a05" href="https://linear.app/fixpoint-labs/issue/FIX-312/kitchen-sink-true-plan-mode-hitl-collaborative-planning-with-phase">FIX-312</issue>) ships on top of this primitive rather than inventing its own.
* **Durability via scope.** Task state persists through the standard scope mechanism — no separate task-persistence story to maintain.

## Why this matters

Today, every multi-agent pattern duplicates work-unit plumbing. New patterns can't easily share state with existing ones. Plan/Task fixes this and is the launch-defining work for the multi-agent story.

## Done when

* TaskCollection + Pattern is the canonical multi-agent substrate
* All shipped multi-agent patterns have been reshaped onto it
* True Plan Mode ships on the primitive
* Skills can declare a pattern via [SKILL.md](<http://SKILL.md>)
* Architecture page + pattern catalog ships

## Tracking

Epic: <issue id="f7c74f16-3097-410d-81e9-a1b0140a6257" href="https://linear.app/fixpoint-labs/issue/FIX-442/plan-task-unified-work-unit-primitive-epic">FIX-442</issue>. Implementations <issue id="9a02e914-81a9-4edf-83df-93853b6d45c8" href="https://linear.app/fixpoint-labs/issue/FIX-449/plantask-impl-6-reshape-fix-312-true-plan-mode-onto-unified-primitive">FIX-449</issue>, <issue id="e710b498-f5e9-4238-9508-70a2a69e7b5d" href="https://linear.app/fixpoint-labs/issue/FIX-450/plantask-impl-7-reshape-fix-422-skills-declare-a-pattern-onto-unified">FIX-450</issue>, <issue id="dc3f220b-e2b4-476b-9ce6-cb64b598df91" href="https://linear.app/fixpoint-labs/issue/FIX-451/plantask-docs-architecture-page-pattern-catalog">FIX-451</issue>; Plan Mode <issue id="5bbb6e5a-6adc-4857-a032-54920fe32a05" href="https://linear.app/fixpoint-labs/issue/FIX-312/kitchen-sink-true-plan-mode-hitl-collaborative-planning-with-phase">FIX-312</issue>.
