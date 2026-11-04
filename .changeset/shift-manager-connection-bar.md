---
"@flow-state-dev/shift-manager": patch
---

When the Lab stops answering after Shift Manager has read it, the page you're on, an open task and anything you've typed now stay on screen. A bar across the top says how long ago the server went, task statuses grey out and their timers stop, and Shift Manager reads the Lab again on its own until it answers. A dropped conversation or task session feed shows the same bar. The full-screen *couldn't reach the Lab* page is now only for a first read that fails, and it retries on its own too (FIX-2373).
