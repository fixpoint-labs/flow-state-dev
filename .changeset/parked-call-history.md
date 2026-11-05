---
"@flow-state-dev/engine": patch
---

A turn that runs while another request in its session waits on a call (`dispatcher({ wait: true })`) now reads that request's history as far as it got, its settled items plus a line naming what it still waits on; a request stopped for its user or waiting on a task stays out (FIX-2279).
