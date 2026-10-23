# workers › it checks roles at hire

**Issue:** FIX-2084 (epic FIX-2056). Its spec's goal: `specs/issues/FIX-2084/SPEC.md` → "The goal, and how we'll know it's met".

**Outcome:** a worker flow that can't do what its roles promise is refused when it is hired, by a refusal that names the flow, the role, the entry and the fix, so nobody finds the fault mid-task. A flow wired from the roles' factories hires and runs a task end to end. Every worker in the repo takes a user's message on `respond`, and every manager runs its board on `dispatch`.

**Input:** built in `run.mts`, through the public `@flow-state-dev/workforce` surface, on a real engine with deterministic turns (handlers, no generator):

- **leg a**, six worker flows with one fault each, each one only the hire's role or door check can refuse: a contributor without `work`; a `work` gated by another board, not built by `workerTaskEntry`; a manager whose `dispatch` is its own, not the board's; a `workerTaskEntry` on a flow that doesn't declare `contributor`; the manager kit spread with its `onTaskSettled` but neither `dispatch` nor `roles`; a door named `run`. Each is hired alone through `hireWorkforce`. None declares a manager without `onTaskSettled`: the board's build check refuses that one first.
- **leg b**, a flow wired only from `workerTaskEntry`, `defineSessionBoard` and a `respond` door, registered `{ flow, roles: ["contributor", "manager"] }`, with two workers on it: a lead whose `delegates:` names the other.
- **leg c**, the repo's worker flows: the built-in `agent` and `coordinator` on an installation, and Shift Manager's devteam host (`openLab`, with a stub harness).

Held out: the flows' names, the task's goal and the workers' ids are arbitrary; the check reads the hire's refusal, the engine's request store and the registered copies, never the flows' source.

**Signal:** each failure is tagged `<leg>:<assertion>`.

- `a:refused` · `hireWorkforce` throws for each broken flow, so nothing is hired.
- `a:one-problem` · the refusal holds exactly one problem.
- `a:names` · the problem names the flow, the role and the entry (and, where there is one, the factory or the `roles` field to fix). For the door, the role is every worker's: it names `run` and `respond`.
- `b:hired` · the flow built from the factories hires.
- `b:filed` · the lead's conversation files a task for the other worker through `createTask_tasks`.
- `b:dispatch` · the conversation's request store holds a completed `dispatch`, and no `runTaskBoard`.
- `b:settled` · the task's ending arrives on the conversation's `onTaskSettled`, completed.
- `b:worked` · a `work` request completed in a task session of its own.
- `b:completed` · the stored row is completed.
- `c:hired` / `c:registered` · each host's worker flows hire and are registered.
- `c:respond` / `c:no-run` · every registered worker flow has `respond` and no `run`.
- `c:dispatch` / `c:no-runTaskBoard` · every manager (a flow registered with `manager` or `coordinator`) has `dispatch`, and no flow has `runTaskBoard`.

**Anti-game:** leg a reads the refusal `hireWorkforce` throws, never `workerFlowProblems`, and each flow carries one fault, so a refusal for another reason fails `a:names`. Leg b reads the engine's request store and the stored row, not the board's report. Leg c reads the registered copies' action maps and the roles each was registered with, not source. Every list the legs grade is floored with `tell.over`.

**Model:** n/a

**Run:** `pnpm tsx goals/workers/roles-checked-at-hire/run.mts`

**Controls:** `GOAL_CONTROL=no-role-check` removes the role check from the hire (a scratch patch to `worker-flow-contract.ts` applied as the process loads, `goals/lib/module-patch.mts`). It must fail **`a:refused`** for the five role faults; the door named `run` is still refused, by the door check, which the control leaves on. Today's `main` (before this change) has no roles, no `respond` and no `dispatch`, so it must fail all three legs.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-23 | fix/FIX-2084, uncommitted goal | n/a | PASS | a: 6/6 refused at hire, one problem each naming flow, role and entry; b: task completed through `dispatch` and `onTaskSettled`; c: 6 registered worker flows (built-ins agent, coordinator; devteam agent, em, coder, coordinator) take `respond`, 5 managers run `dispatch` |
| 2026-10-23 | fix/FIX-2084, uncommitted goal | n/a | FAIL (control `no-role-check`, expected) | `a:refused` for takes-nothing, gated-elsewhere, own-pass, quiet-taker, half-kit: each hired; old-door still refused by the door check |
| 2026-10-23 | main 417389c15, this goal copied in | n/a | FAIL (today's `main`, expected) | a: all six hired; b: the pass ran as `runTaskBoard`, no `dispatch`; c: every built-in and devteam worker flow has `run` (EM and coder `message`) and no `respond`, and `runTaskBoard`; `c · managers` read 0 (no roles on `main`) |
