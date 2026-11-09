// FIX-2614.
/**
 * The routine names workforce's `/internal` subpath carries: the id and key
 * prefixes other FSD packages, goals and scripts read a stored routine by, not
 * an adopter's surface.
 */
export { CLOCK_ROUTINE_PREFIX, DECLARED_ROUTINE_KEY_PREFIX, EVENT_ROUTINE_PREFIX } from "./keys";
