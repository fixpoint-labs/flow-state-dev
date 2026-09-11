---
"@flow-state-dev/workforce": minor
---

New `readSeatSkills(root, { team, worker })` on `@flow-state-dev/workforce/loader`: reads the skills one seat can see — the org's, its own team's, and any sitting beside the worker, which are included without being listed — and returns the same `InitialSkill[]` `initialSkills` takes. A name reaching one seat from two of those levels is refused, naming both paths; two teams may each carry the same name (FIX-1356).
