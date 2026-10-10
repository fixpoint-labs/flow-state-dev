/**
 * A worker's delegates: the workers it hands work to, which any worker's
 * file may list as `delegates:` (FIX-1802 D1).
 *
 * - The pinned names: the four delegate actions an app sends
 *   (`addDelegate`, `removeDelegate`, `setFallback`, `listDelegates`) and the
 *   most delegates one session holds.
 * - `delegateRecordSchema`: one delegate record, as `listDelegates` answers it.
 * - `DelegateTakes`: what `listDelegates` says each delegate takes.
 * - `TaskDelegates`: a session's delegates as a task sees them.
 *
 * A flow carries them, with the task board they file onto, through
 * `defineSessionBoard`.
 */
export { ADD_DELEGATE, LIST_DELEGATES, MAX_DELEGATES, REMOVE_DELEGATE, SET_FALLBACK } from "./delegate-keys";
export { delegateRecordSchema, type DelegateRecord } from "./delegate-list";
export type { DelegateTakes } from "./delegate-check";
export type { TaskDelegates } from "./worker-delegates";
