/**
 * The entries every worker kind takes work through: tasks, and delegated
 * posts. A leaf module, so a kind that declares an entry and the lookup that
 * checks for it share the name without either importing the other.
 */

/**
 * The task entry every worker kind takes tasks through. **Pinned**: a list's
 * fallback hands over to it, and so does the wake.
 */
export const WORKER_TASK_ENTRY = "work";

/**
 * The internal entry a worker flow declares to take a delegated post. A
 * worker whose flow declares it can be a delegate that takes posts.
 */
export const DELEGATED_POST_ENTRY = "onDelegatedPost";
