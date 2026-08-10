---
"@flow-state-dev/core": minor
---

Detached worker bindings are derived from a block's retained children, and a
flow refuses a board it cannot route to (FIX-982).

Bindings used to be propagated by hand wherever blocks compose — sixteen call
sites in the sequencer, each passing three separate projections of the same child
block. The child was already there at every site and was discarded, so every rail
had to be remembered separately at every site.

- Block composition now hands over the **child block itself** and derives the
  rails from it. A composition site can no longer remember two rails out of
  three; the only thing it can drop is the child, which drops everything at once
  and is caught at definition time.

- `BlockDefinition` gains `childBlocks` — every block a block statically
  composes: a sequencer's step children and chain-level rescue handlers, a
  router's routes, the block `asTool` wraps. A sequencer step used to be a
  closure with the child captured inside it and retained nowhere, so the block
  graph could not be walked past the first step.

- `defineFlow` walks that graph and **throws when a reachable block declares a
  detached worker the flow did not collect**, naming the board, coordinate and
  worker. Previously such a board built cleanly and failed later as a detached
  task that was admitted, claimed, dispatched, and then never ran.

- Replacing a block's rescue handlers (`.rescue([a]).rescue([b])`) now forgets
  `a`'s boards instead of advertising workers nothing can reach, and no longer
  throws a spurious duplicate-coordinate error when `b` takes the same
  coordinate. A block declaring `rescue` inline in its config now bubbles its
  handlers' bindings too, which it previously did not.

- `FlowType` gains `workstreamBindings`, mirroring the flow instance. Code
  inspecting the flow blueprint directly saw actions, resources, schedules and
  `requiresOrg` but no detached registry, and could reasonably conclude the flow
  declared no detached work.

`minor` rather than `patch`: `declareWorkstreamBindings` is exported, so stamping
a block after composing it now surfaces as a build-time refusal where it
previously passed silently.
