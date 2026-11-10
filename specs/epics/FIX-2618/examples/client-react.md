# The UI uses a kit's client half

[Spec](../SPEC.md) · [Decisions](../DECISIONS.md) · example

> **PROPOSED.** A sketch from the design review, not code. None of the APIs it names exist yet (`defineView`, `defineKit`, `runBy`, `fsd.resource`, `useView`, `ViewOutput`, kit slots and the kits' views). The name "kit" is the owner's answer to [O5](../DECISIONS.md#o5). The child that builds each piece owns its real shape.

Live by default, because the view declared its dependencies: no topics and no session in the component. Underneath, the shared live read ([FIX-2551](https://linear.app/fixpoint-labs/issue/FIX-2551)) re-runs the view on its notices; with ids on notices ([FIX-2625](https://linear.app/fixpoint-labs/issue/FIX-2625)) a notice re-runs only the rows it names.

```tsx
function MissionPage({ missionId }: { missionId: string }) {
  const { value: board, stale } = useView(mission.views.missionBoard, { missionId });  // no topics, no session
  const start = mission.useAction("objective", "start");                            // goes to the objective's session
  return <Objectives rows={board ?? []} stale={stale} onStart={(id) => start({ objective: id })} />;
}

// Underneath: client.live over the view's notices; a notice with keys re-runs just those rows.
```

A write is one line too, and still goes through a flow: the resource's `runBy`, here the default write flow ([O3](../DECISIONS.md#o3)).

```tsx
function PinButton({ taskId }: { taskId: string }) {
  const pins = useResource(app.resources.pins);                                     // direct read, no session
  return <Pin on={pins.value?.pinned.includes(taskId)}
              onClick={() => pins.update((s) => ({ pinned: toggle(s.pinned, taskId) }))} />;  // pin or unpin; re-run on a version conflict
}
```
