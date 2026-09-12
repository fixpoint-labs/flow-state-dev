---
"@flow-state-dev/orchestration": minor
---

A skill `agents:` `prompt-ref` entry is the seat name only — `tools`, `model`, `visibility`, and `context-supply` now live in the prompt file's YAML frontmatter, and leftover skill-entry tuning is rejected at parse (FIX-1370).
