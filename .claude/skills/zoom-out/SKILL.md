---
name: fsd:zoom-out
description: Tell the agent to zoom out and give a higher-level map of an unfamiliar area of the @flow-state-dev codebase, named in FSD vocabulary. Use when you've just landed in an area and want the lay of the land before touching anything.
disable-model-invocation: true
---

I don't know this area well. Zoom out and give me a map.

Use **FSD vocabulary** for everything you name:

- **Package** (`@flow-state-dev/<pkg>`) and its role in the layered architecture (core / server / client / react / cli / testing / store-* / patterns / capabilities / memory / ui / etc.)
- **Flow** and its **actions** — what's the top-level surface, and which actions live on it?
- **Block** kinds in the area — handlers, generators, sequencers, routers. Name the root block of each action.
- **Pattern** factories and **capabilities** in play — what's the reusable composition machinery here?
- **State scopes** the area reads/writes (request / session / user / project) and which resources it touches.
- **Items** the area emits to the stream (message / reasoning / block_output / component / status / state_change / error / etc.) — useful for understanding what reaches the client.
- **Boundaries** — does this area cross `server`↔`client` or `client`↔`react`? Where are the seams?
- **Callers** — what flows, blocks, or external entry points pull on this area? Where would a change ripple?

Cross-reference the relevant `docs/architecture/<area>.md` doc as the authoritative reference for any contract you describe.

Keep the map terse — a list of named things and one-line roles, not prose paragraphs. The point is to give me an index I can jump from, not a tutorial.
