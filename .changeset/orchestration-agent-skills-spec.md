---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/core": patch
---

Skills now follow the Agent Skills specification (https://agentskills.io/specification)
in full for a SKILL.md's frontmatter (FIX-1318).

- `name`, `license`, `compatibility`, and `metadata` are parsed into typed fields
  on `SkillState` (and `Skill`) instead of being kept only as preserved unknown
  keys. `name` is validated and must match the folder it lives in;
  `compatibility` is capped at 500 characters; `metadata` is a string → string
  map. `MAX_COMPATIBILITY_LENGTH` is exported alongside the existing caps.
- `parseSkillMd` takes an optional `{ expectedName }` so directory readers and
  seeders can enforce the name/folder match. `readSkillsDirectory`,
  `importSkillsDirectory`, `ensureSeeded`, and `createSkillsLibrary` pass it.
- Skill names follow the spec's hyphen rules: no leading, trailing, or
  consecutive hyphens. Names like `pdf-` or `pdf--tools` were accepted before
  and are rejected now.
- `allowed-tools` accepts the spec's space-separated string form
  (`allowed-tools: search fetch`) in addition to a YAML list, and
  `serializeSkillMd` writes it in the spec form.
