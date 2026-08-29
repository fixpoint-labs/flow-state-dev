---
"@flow-state-dev/fsdev": patch
---

`fsdev conductor` reads `CONDUCTOR_CONFIG` as the config path when `--config` is omitted, so a product checkout can export the lab once and run the board without repeating `--config`. An explicit `--config` or `--no-config` still wins. (LAB-151)
