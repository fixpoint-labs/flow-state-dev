---
"@flow-state-dev/orchestration": patch
"@flow-state-dev/workforce": patch
---

A task's notice held while the request that filed the task was running now reaches the filer about two seconds after that request parks on a person or a wait, rather than at the notice's next resend, which could be up to 5 minutes away once its backoff had grown. The park owes the filer's pass one wake and reads no row. In Workforce, a drain parked on a step that runs in a session of its own now resumes within seconds when the step ends while the drain is still parking, rather than at the wait's deadline (FIX-2149).
