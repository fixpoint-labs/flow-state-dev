// FIX-2614, epic FIX-2471 D12.
/**
 * Routines: one name, list and tool set over clock routines (schedule rows)
 * and event routines (subscription rows). The user reaches them on the roster
 * flow; a worker through `routineTools`. `hireWorkforce`'s `routines` takes the
 * schedule index, the providers and the app's declared routines.
 */
export { CLOCK_ROUTINE_PREFIX, DECLARED_ROUTINE_KEY_PREFIX, EVENT_ROUTINE_PREFIX, LIST_ROUTINES_ACTION, ROUTINE_CADENCES, ROUTINE_VERBS } from "./keys";
export { listedRoutineSchema, routineMakerSchema, type ListedRoutine, type RoutineMaker } from "./listed-routine";
export {
  checkDeclaredRoutines,
  declaredRoutineKey,
  routineTools,
  saveRoutineInputSchema,
  seedDeclaredRoutines,
  type DeclaredRoutine,
  type RoutinesOptions,
  type SaveRoutineInput,
  type SeedOutcome
} from "./routines";
