// FIX-2614.
/**
 * The routine names workforce's `/internal` subpath carries: the id and key
 * prefixes other FSD packages, goals and scripts read a stored routine by, and
 * the one seed of the app's declared routines with the key it writes them
 * under, which a startup trigger (a poll host's) calls rather than writing a
 * declared routine itself. Not an adopter's surface.
 */
export { CLOCK_ROUTINE_PREFIX, DECLARED_ROUTINE_KEY_PREFIX, EVENT_ROUTINE_PREFIX } from "./keys";
export { declaredRoutineKey, seedDeclaredRoutines, type SeedOutcome } from "./routines";
