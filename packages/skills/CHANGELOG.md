# @flow-state-dev/skills

## Pre-1.0 history

Captured from the project's pre-Changesets development log (root `changelog.md`,
deleted on FIX-653). Entries are listed newest-first.

### 2026-05-13 — Skills declare a pattern (FIX-450)

`SKILL.md` frontmatter can now declare `pattern: task-board` (or any registered key) plus a `workers:` map, an `initial-tasks:` list, and a `pattern-config:` block. Activating the skill materializes a `TaskCollection`, builds worker generators on the fly, runs the pattern, and streams progress through `<TaskPlan />`. Workers carry exactly one of `prompt`, `prompt-ref`, `block-ref`, or `agent-ref` — the last is the reserved slot for the forthcoming Agents primitive and throws clear deferral errors at activation.

### 2026-04-26 — Org scope rename (FIX-428) [BREAKING]

Skill resource scopes renamed `project` → `org`.

### 2026-04-25 — Up-front skill activation router (FIX-421)

New `createIntentSelector()` — a three-tier sequencer that decides which skills apply before the main generator runs. Tiers: literal `/<skill-name>`, local keyword scan, structured-output classifier (only runs when 1–2 are inconclusive). New `keywords` frontmatter field on `SKILL.md` for tier-2 matching. `createSkillsCapability` ships `tools`, `context`, and `runSkill` presets (all on by default).
