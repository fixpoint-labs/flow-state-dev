---
"@flow-state-dev/workforce": minor
---

A worker given a task can split it: its task session files pieces for its own delegates, its task waits on them and completes from their outputs, or fails naming the pieces that failed for good. A chain of split tasks is at most five boards deep, and one top task has at most 100 tasks under it, finished ones included; `hireWorkforce(installation, { taskChainLimit })` sets an app's own limit. A filing past either is answered `total_task_cap_exceeded`. Cancelling a split task cancels its open pieces, down the chain. A worker flow's `work` entry now holds its session's reply line, so a piece's notice waits for the turn that filed it (FIX-1802).
