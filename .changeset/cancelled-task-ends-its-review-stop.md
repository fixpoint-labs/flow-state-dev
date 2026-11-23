---
"@flow-state-dev/orchestration": patch
---

A run that stops for a person after its task moved on no longer waits forever (FIX-2847). Before, a coding run whose task was cancelled while its judge read stopped for its review anyway. No row held that stop, and the cancel had found nothing to resume, so the run's request stayed `suspended`. A session's runs counted it as background work still running, and its review card could still be answered.

Now, when the claim gate checks a request that stopped for a person, and the row has moved on before the gate could record that stop:

- **The task ended** (cancelled, or finished): the stop is cancelled as the task's cancel would have, and the run asks nobody again.
- **A later attempt or turn holds the task:** the old request's stop is ended as superseded. The task is not cancelled, and the newer claim's row is not written.
- **Only the lease lapsed** (no other claim took the row): the gate takes the row back, as a lapsed holder may, and records the stop. The review waits for its person, as it does with no lapse.
- **Taking the row back failed with an error** (not a refusal): the stop stays for its person, and a warning names the error. It is not ended, because the attempt may still own the row.
