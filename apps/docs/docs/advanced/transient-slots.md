---
sidebar_position: 7
---

# Transient slots

Most sequencer state is observable. When a sequencer changes state, the runtime emits a `state_change` event and a trace-only `state_snapshot` item so devtools can show progress.

Some fields are runtime scratch. They coordinate an execution but should not appear in state snapshots or trigger state-change notifications on their own. Mark those fields with `transientSlot()`.

```ts
import { sequencer, transientSlot } from "@flow-state-dev/core";
import { z } from "zod";

const research = sequencer({
  name: "research",
  stateSchema: z.object({
    progress: z.number().default(0),
    scratchBuffer: transientSlot(z.array(z.string()).default([])),
  }),
});
```

`scratchBuffer` still exists while the sequencer is running. Blocks that can access the sequencer state can read and write it. The difference is in observability:

- `state_snapshot` omits transient keys.
- A write that only changes transient keys does not emit a `state_change` item.
- Non-transient keys still behave normally.

Use transient slots for caches, temporary coordination data, or large intermediate payloads that are not useful to replay in DevTool. Do not use them for user-visible progress or data that another persisted item needs to explain.

## Related pages

- [Sequencer state](/docs/advanced/sequencer-state)
- [Emitting items](/docs/streaming/emitting-items)
- [Items overview](/docs/streaming/overview)
