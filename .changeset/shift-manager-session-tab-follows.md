---
"@flow-state-dev/shift-manager": patch
---

A task's Session tab now follows the run's session stream from its newest steps. A dropped connection reconnects and keeps what is shown, instead of blanking the transcript. A worker conversation or a Session that holds more than its first page shows *Load earlier*, which reaches back a page at a time to the first step.
