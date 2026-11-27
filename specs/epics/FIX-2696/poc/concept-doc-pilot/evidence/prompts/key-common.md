R1. An app is the whole thing you run and own, in your repo: its pages, workers, config, the kits it installs and its own flows. A starter gives you one.
R2. A kit is an installable feature, listed in the app's config (`kits: [...]`), that brings flows (and views, files it reads). Kits can open slots and fill other kits' slots.
R3. A flow is a backend unit you call (over HTTP): a client runs its actions, it streams results back and keeps typed state. Flows are built from blocks.
R4. A block is a typed unit of work that flows are built from: a model call, your code, a chain of steps, a choice of one block, a typed model question (five kinds).
R5. (a) the worker's WORKER.md file, no TypeScript; (b) add a kit to the app's config; (c) a block (a step inside a flow).
