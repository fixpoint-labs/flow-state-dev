/**
 * Type-level tests for `withOutcome` / `updateStateWith` (FIX-995).
 *
 * The load-bearing one is the last block: a synchronous runner must reject an
 * `async` updater. Nothing at runtime can catch that — if the types allow it,
 * the helper hands the runner a Promise where it expects the next state, and a
 * runner like `casWrite` persists it. The `@ts-expect-error` below is the guard:
 * delete the sync overload and it becomes an unused-directive error, which
 * fails `pnpm typecheck`.
 */
import { withOutcome, updateStateWith } from "../update-state-with";

type Tasks = Record<string, { id: string }>;
type Wm = { entries: string[]; turn: number };

// ── A synchronous runner: the `casWrite` shape, `(mutate) => Promise<void>` ──
declare const casWrite: (
  mutate: (tasks: Readonly<Tasks>) => Tasks | undefined
) => Promise<void>;

// ok — a synchronous updater against a synchronous runner
void withOutcome(casWrite, (tasks) => ({
  state: { ...tasks, x: { id: "x" } },
  result: Object.keys(tasks).length,
}));

// ok — a synchronous updater may also decline by returning `undefined` state
void withOutcome(casWrite, () => ({ state: undefined, result: "declined" as const }));

// ── An async-capable runner: `updateState`, whose mutator may return a Promise ──
declare const ref: {
  updateState(updater: (state: Wm) => Wm | Promise<Wm>): Promise<void>;
};

// ok — a synchronous updater against an async-capable runner
void withOutcome(
  (m: (s: Wm) => Wm | Promise<Wm>) => ref.updateState(m),
  (s: Wm) => ({ state: s, result: s.turn })
);

// ok — an ASYNC updater against an async-capable runner
void withOutcome(
  (m: (s: Wm) => Wm | Promise<Wm>) => ref.updateState(m),
  async (s: Wm) => {
    await Promise.resolve();
    return { state: s, result: s.turn };
  }
);

// ok — `updateStateWith` accepts an async updater, since `updateState` does
void updateStateWith(ref, async (s: Wm) => {
  await Promise.resolve();
  return { state: s, result: true };
});

// ── The guard: an ASYNC updater must NOT type-check against a SYNC runner ──
// Without it, `casWrite` receives a Promise as the next tasks map and writes it.
// @ts-expect-error - an async updater cannot be used with a synchronous runner
void withOutcome(casWrite, async (tasks: Readonly<Tasks>) => {
  await Promise.resolve();
  return { state: { ...tasks }, result: 1 };
});
