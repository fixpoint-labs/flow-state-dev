/**
 * What the scripted harnesses were handed, in order: every prompt a run was
 * sent and every line a running turn took (Cursor's steer). Test mode only.
 *
 * The parity test reads it to hold that a line sent mid-turn reaches the run
 * exactly once, whichever way it went: into the running turn, or as the next
 * turn's prompt.
 */
export const scriptedReceived: string[] = [];
