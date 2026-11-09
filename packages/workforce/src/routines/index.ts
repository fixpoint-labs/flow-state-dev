// FIX-2614, epic FIX-2471 D12.
/**
 * Routines: one name, list and tool set over clock routines (schedules)
 * and event routines (subscriptions). The user reaches them on the roster
 * flow; a worker through the routines capability (`createRoutinesCapability`), when
 * its flow's `uses` names it. `hireWorkforce`'s `routines` takes the
 * schedule index, the providers and the app's declared routines. The id and key
 * prefixes are on `@flow-state-dev/workforce/internal`.
 */
export { LIST_ROUTINES_ACTION, ROUTINE_CADENCES, ROUTINE_VERBS } from "./keys";
export { listedRoutineSchema, routineMakerSchema, type ListedRoutine, type RoutineMaker } from "./listed-routine";
export { createRoutinesCapability, declaredRoutineKey, type DeclaredRoutine, type RoutinesOptions } from "./routines";
