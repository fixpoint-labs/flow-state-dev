# claude-code-style: what is left of the adapter

[Spec](../SPEC.md) · [Decisions](../DECISIONS.md) · example

> **PROPOSED.** A sketch from the design review, not code. None of the APIs it names exist yet (`defineView`, `defineKit`, `runBy`, `fsd.resource`, `useView`, `ViewOutput`, kit slots and the kits' views). The name "kit" is the owner's answer to [O5](../DECISIONS.md#o5). The child that builds each piece owns its real shape.

`src/lab.ts`, proposed, replacing `src/adapter.ts` (1,498 lines). Mostly the app's own thread renderer, plus a handful of hooks named in the app's words. **About 250 lines in all, about 135 of them the renderer that was already the app's. That is an estimate;** [FIX-2628](https://linear.app/fixpoint-labs/issue/FIX-2628) measures it. The second block is a component's side of it, today against proposed.

```ts
// Thread rendering stays: entriesOf, withStopped (~135 lines, moved here unchanged) and ThreadEntry.
export { entriesOf, withStopped, type ThreadEntry } from "./lib/thread";

export const useSessions = () =>
  useView(workforce.views.workerSessions, { workers: MODES.map((m) => m.worker) });

export const useTasks = (sessionId: string) =>
  useView(harnesses.views.codingBoard, { sessionId });          // rows carry openHold, harness, PRs, review, error

export const useTaskWork = (taskId: string) => {
  const work = useView(harnesses.views.runWork, { taskId });    // inFlight, plan, review stop
  const feed = useSessionFeed(work.value?.runSessionId, { itemTypes: THREAD_ITEMS });
  return { ...work.value, entries: entriesOf(feed.items) };
};

export function useThread(sessionId: string, threads: boolean) {
  const feed = useSessionFeed(sessionId, { itemTypes: THREAD_ITEMS });
  const turns = useView(workforce.views.turns, { sessionId });  // running, stopped, retryable
  return {
    entries: withStopped(entriesOf(feed.items, threads, turns.value?.retryable), turns.value?.stopped),
    running: turns.value?.running ?? false,
    connection: feed.state,
    loadEarlier: feed.loadEarlier,
  };
}

export const usePins = () => useResource(claudeCodeStyle.resources.pins);   // { value, update }
// A pin, in a component, is one line through the default write flow (O3):
//   pins.update((s) => ({ pinned: toggle(s.pinned, taskId) }))   // pin or unpin, at the version read

// ~250 lines in all, ~135 of them the renderer that was already the app's. Today: 1,498.
```

A component's side of it. Today the adapter is passed down and each pane wraps a watch verb; proposed, the pane uses the kit's hooks and its types are inferred from the view.

```tsx
// Today: the adapter is passed down, and each pane wraps a watch verb.
const rows = useWatch((on) => adapter.watchTasks(sessionId, on, setStale), [sessionId]);
const calls = useMemo(() => adapter.taskActions(sessionId), [sessionId]);

// Proposed: the pane uses the kit's hooks; types are inferred from the view.
const { value: rows, stale } = useTasks(sessionId);
const board = useBoard(sessionId);                     // orchestration kit: cancel, steer, release, retry
const answer = useAnswer();                            // answers row.openHold directly; no hold lookup first
```

## The fifteen types

| Type | Today | Fate |
|---|---|---|
| `LabTask` | Hand-written row: status, hold, harness, PRs, review, spend, error, times | **From a view:** the coding board view's output, orchestration's task view plus harness fields |
| `LabSession` | Title, worker, running, waiting, project | **From a view:** `workforce.views.workerSessions` |
| `LabProject` | `{ id, name }` | **From a view:** `workforce.views.myProjects` |
| `TaskWork` · `WorkingNow` | Run entries, review stop, in-flight call, plan | **From a view:** `harness.views.runWork`; entries come from the app's renderer |
| `TaskStatus` | A copy of six statuses | **Exists:** `TaskStatus` in orchestration (`tasks/schema/task-status.ts:22`) |
| `RepositoryCheck` | A copy | **Exists:** `RepositoryCheckAnswer` in workforce (`projects/project-writes.ts:168`) |
| `ConnectionState` · `LabHarness` · `TaskBoardCalls` · `ReviewDetail` | Aliases of package types | **Exists:** use the package names |
| `Item` | A partial copy of a stored item's shape | **Exists:** the contracts item types |
| `Unsubscribe` | `() => void` | **Gone:** hooks own the lifetime |
| `LabAdapter` | The 17-verb seam (FIX-2152 D4's fixtures-first design) | **Gone:** components call kit hooks; tests run on an in-process host, as FIX-2406 already does |
| `ThreadView` | Entries, running, stopping, connection, turn start | **Shrinks:** about 5 lines joining the feed, the turns view and entries |
| `ThreadEntry` | User line, brief, reply, tool run, result card, stopped marker | **Stays:** how this app draws a thread. Teammates draws it differently |

The same rule applies to `src/lib`. `session-title.ts`'s first-line fallback and the waiting
count behind `columns.ts` move into the sessions view, so the server computes them once. The
column grouping, `result-summary.ts`, `tool-steps.ts` and `first-run.ts` are presentation, and
stay.

## Where the verbs go

| Verb | Today | Becomes | Provided by |
|---|---|---|---|
| `watchSessions` | 98 lines, plus row assembly per row | `useView(workforce.views.workerSessions, { workers })` | workforce kit; title fallback and running/waiting counts computed on the server |
| `listProjects` · `createProject` · `checkRepository` | ~15, over an own session | `useView(workforce.views.myProjects)`, `workforce.projects.create()` | workforce kit |
| `readHarnesses` | 2, over the readiness flow's own session | `useView(harness.views.readiness)` | harness kit |
| `openSession` · `send` | ~21 | `workforce.openSession({ worker, project })`, `workforce.respond(sessionId, text)` | workforce kit |
| `interrupt` · `retry` | ~35, tracking aborted turns by hand | `fsd.sessions.interrupt(id)`, `request(id).retry()` | client: a session-level interrupt is a generic need |
| `watchThread` | 102: feed, a turns watch, stop tracking | `useSessionFeed(id)` + `useView(workforce.views.turns, { sessionId })` + the app's `entriesOf` | client, workforce kit, app |
| `watchTasks` | 3, over `boardOf` (~380 behind it) | `useView(harness.views.codingBoard, { sessionId })` | orchestration's board view + harness fields |
| `watchTaskWork` | 96: run feed, request stream, plan watch, merging | `useView(harness.views.runWork, { taskId })` + `useSessionFeed(run)` | harness kit |
| `sayInThread` · `taskActions` · `resolve` · `requestChanges` | ~20, looking up the open hold first | the board's steer/cancel calls, an answer to `row.openHold` | orchestration; the board view row already carries its hold |
| `watchPins` · `pin` · `unpin` | 9, plus the own session | `useResource(app.resources.pins)` and its `update`, through the default write flow | app kit: a direct read, a write through a flow |

Line counts are from reading `src/adapter.ts` today; what each verb becomes is proposed.
