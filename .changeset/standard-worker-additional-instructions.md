---
"@flow-state-dev/workforce": minor
---

A standard worker's core instructions can no longer be replaced. Users add to them instead (FIX-2988).

- **New field, `additionalInstructions`.** A worker row and the roster's `edit` (and `WorkforceClient.edit`) take `additionalInstructions`. Each turn reads them after the worker's own instructions, under an `## Additional instructions` heading. `null` or a blank string clears them. Rows stored before the field read as having none.
- **Behaviour change: `edit` refuses `instructions` on a standard worker.** The refusal says to use `additionalInstructions` instead, and nothing is written. The user's copy of a standard worker now reads its file's core and team instructions on every turn, so a later edit to the file reaches it. A worker the user hired or forked keeps instructions they can replace.
- **Saved copies with replaced instructions.** A standard worker's copy saved earlier with instructions that differ from its file's keeps that text, now read as additional instructions after the file's core ones. The next save of the additions takes over from it.
- **New read: `WorkforceClient.instructions(id)`.** It returns `{ instructions, additionalInstructions, fixed }` through the roster flow's new `workerInstructions` view (`workerInstructionsView`, type `WorkerInstructions`). `fixed` is `true` for a standard worker, whose core instructions an edit can't replace.

Docs: apps/docs workforce pages that show editing a worker (the roster's `edit` input and `WorkforceClient`), and packages/workforce/README.md (the `additionalInstructions` field, the refusal on standard workers, and `instructions(id)`)
