---
"@flow-state-dev/workforce": minor
---

Workforce says worker and worker flow throughout: the `seat*` exports, configuration keys (`workerId`, `workerSkills`, `workerTools`, `workerPackages`) and stored names say worker, `KindRefusedHireError` is `WorkerFlowRefusedHireError`, `AGENT_KIND` is `AGENT_FLOW`, `fsdev gen` exports its worker flows as `workerFlows` (was `kinds`; run `fsdev gen` again), `discover:` takes `workers`, the loader's `SegmentLabel` `"Kind"` is `"Worker flow"`, and a best-fit coordinator's route question is answered under `worker` (was `member`), so a mocked evaluation model answers `{ worker: … }`; there are no aliases, and records saved under the old names are not read (FIX-1796).
