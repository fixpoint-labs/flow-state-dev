// FIX-2614.
/**
 * The routine names workforce's `/internal` subpath carries: the id and key
 * prefixes other FSD packages, goals and scripts read a stored routine by, and
 * the one seed of the app's declared routines with the key it writes them
 * under, which a startup trigger (a poll host's) calls rather than writing a
 * declared routine itself. And the four worker verbs as blocks, for a check
 * that runs them as actions, as a model would, with no model. Not an
 * adopter's surface: a worker flow gets the verbs through the routines
 * capability.
 */
export { CLOCK_ROUTINE_PREFIX, DECLARED_ROUTINE_KEY_PREFIX, EVENT_ROUTINE_PREFIX } from "./keys";
export { declaredRoutineKey, seedDeclaredRoutines, workerRoutineVerbs, type SeedOutcome } from "./routines";
