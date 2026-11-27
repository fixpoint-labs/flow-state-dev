# The UI imports from a kit's package

[Spec](../SPEC.md) · [Decisions](../DECISIONS.md) · example

> **PROPOSED.** A sketch from the design review, not code. None of the APIs it names exist yet (`defineView`, `defineKit`, `runBy`, `fsd.resource`, `useView`, `ViewOutput`, kit slots and the kit packages' views). The name "kit" is the owner's answer to [O5](../DECISIONS.md#o5). The child that builds each piece owns its real shape.

A kit has no client runtime ([FIX-2626 D1](../../../issues/FIX-2626/DECISIONS.md#d1)): a screen imports the kit package's views, hooks and components from its browser entry and `/react`. Live by default, because the server records what each run of the view read: no topics and no session in the component. Underneath, the shared live read ([FIX-2551](https://linear.app/fixpoint-labs/issue/FIX-2551)) re-runs the view on its notices; with ids on notices ([FIX-2625](https://linear.app/fixpoint-labs/issue/FIX-2625)) a notice re-runs only the rows it names.

```tsx
import { missionBoard, useStartObjective } from "mission/react";   // the package's browser exports

function MissionPage({ missionId }: { missionId: string }) {
  const { value: board, stale } = useView(missionBoard, { missionId });  // no topics, no session
  const start = useStartObjective();                                     // an ordinary package hook over the objective flow's action
  return <Objectives rows={board ?? []} stale={stale} onStart={(id) => start({ objective: id })} />;
}

// Underneath: client.live over the view's notices; a notice with keys re-runs just those rows.
```

A write is one line too, and still goes through a flow: the resource's `runBy`, here the default write flow ([O3](../DECISIONS.md#o3)).

```tsx
import { pins } from "./resources";   // the app's own resource, declared on its flow

function PinButton({ taskId }: { taskId: string }) {
  const { value, stale, update } = useResource(pins);                // direct read, no session
  return <Pin on={value?.pinned.includes(taskId)} stale={stale}
              onClick={() => update((s) => ({ pinned: toggle(s.pinned, taskId) }))} />;  // pin or unpin; re-run on a version conflict
}
```
