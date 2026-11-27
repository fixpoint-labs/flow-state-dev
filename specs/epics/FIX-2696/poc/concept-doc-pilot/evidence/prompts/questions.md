# Cold-read questions

Written 2026-11-12, before any B or C page existed. The reader sees no arm label.

## Reader questions from SPEC.md (asked on every page)

- R1. What is an app in Flow State?
- R2. What is a kit?
- R3. What is a flow?
- R4. What is a block?
- R5. Which one do you change for each: (a) a worker's instructions, (b) adding a whole feature such as coding agents, (c) one step inside how a request is handled?

Key. R1: the whole thing you run and own (pages, workers, config, its kits and its own flows) in your repo; a starter gives you one. R2: an installable feature listed in the app's config (`kits: [...]`), bringing flows, views and files it reads; it can open and fill slots. R3: a backend you call over HTTP; a client runs its actions, it streams results and keeps typed state; built from blocks. R4: a typed unit of work (a model call, your code, a chain, a pick, a typed model question) that flows are built from; five kinds. R5: (a) the worker's WORKER.md file, no TypeScript; (b) add a kit to the app's config; (c) a block inside a flow.

Scoring: 1 per question; R5 needs all three parts; "the page does not say" scores 0; a partly right answer scores 0.5.

## Page 1: what Flow State is

- P1.1 You want your app's researcher worker to stop guessing prices and to cite where each fact came from. What do you edit, and do you need to write TypeScript?
  Key: its WORKER.md (a Markdown brief); no TypeScript; the app picks it up on restart.
- P1.2 Your app has the workforce kit. You want workers to hand code changes to Claude Code. What do you add, and how do the pieces connect?
  Key: add the harnesses kit and the claudeCode kit to `kits`; claude-code fills a slot that harnesses opens.
- P1.3 Which block kind do you use to (a) call a model, (b) run your own code, (c) pick one of several blocks to run?
  Key: generator, handler, router.

## Page 2: tasks and boards

- P2.1 Three research tasks run, and a compare task depends on all three. One research task fails. What happens to the other two research tasks, to compare, and how does the run end?
  Key: the failed task is errored; the other two carry on; compare is cancelled and never runs; the drain stops and reports blocked-by-failures.
- P2.2 After the request that ran the board finishes, a user adds a new task. Does it run? What does it take for tasks to survive across requests and get run?
  Key: not by itself; it waits until something runs the drain again (not a background queue); tasks must be stored in a resource (session, user or org scope), not the request default.
- P2.3 How does the compare task's block get the three research results?
  Key: on its input, the dependencies' outputs keyed by task id (`input.deps`).

## Page 3: workers

- P3.1 Alice and Bob use the same app, which defines a standard engineering.lead. Can Bob open Alice's conversation with her lead, or read what it remembers about her?
  Key: no; each user has their own copy on their own roster, private to that user.
- P3.2 Alice wants a lead that behaves differently, and she is using the running app, not the repo. What can she do?
  Key: she cannot edit the standard worker in the app; she forks it (her own copy from the same settings) or hires a new worker; it is hers alone; no file changes, no restart.
- P3.3 The lead files a task for engineering.designer, which is not in its delegates. What happens?
  Key: refused, and the refusal names the worker; a worker can hand work only to its own delegates.
