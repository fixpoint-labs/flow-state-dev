/**
 * The task entry every worker kind takes tasks through. A leaf module, so a
 * kind that declares the entry and the lookup that checks for it share the
 * name without either importing the other.
 */

/**
 * The task entry every worker kind takes tasks through. **Pinned**: a list's
 * fallback hands over to it, and so does the wake.
 */
export const WORKER_TASK_ENTRY = "work";
