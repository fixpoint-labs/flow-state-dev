---
"@flow-state-dev/workforce": patch
"@flow-state-dev/orchestration": patch
---

New `@flow-state-dev/workforce/loader` subpath: `readWorkforceDirectory(root)` scans `teams/<id>/workers/<name>/` and returns one neutral manifest per worker, so a workforce can be declared in files instead of wired by hand (FIX-1335). `orchestration` gains `splitFrontmatter` and `parseFrontmatterYaml`, the frontmatter dialect `SKILL.md` and `WORKER.md` share; parsed frontmatter records now have no prototype, so a `__proto__:` key in a hand-written file is carried as an ordinary key instead of silently replacing the record's prototype.
