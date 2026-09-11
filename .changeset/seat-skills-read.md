---
"@flow-state-dev/workforce": patch
---

New `readSeatSkills(root, { team, worker })` on `@flow-state-dev/workforce/loader`: reads the skills one seat can see — the org's, its own team's, and any sitting beside the worker, which are included without being listed — and returns the same `InitialSkill[]` `initialSkills` takes. A name reaching one seat from more than one of those levels is refused, and its error entry carries every colliding path in `paths`; two teams may each carry the same name. Anything that should have reached the seat and did not lands in `errors`, each entry tagged with a `kind` naming which condition it is, so a caller can tolerate one class and refuse another without reading the message text (FIX-1356).
