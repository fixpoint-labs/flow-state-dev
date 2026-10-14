/**
 * The Error Reporter's names, in a leaf module: the board's drain sends an
 * owed report by them without importing the reporter (FIX-1983).
 */

/** The flow the reporter runs on: its conversation and its report sessions. */
export const ERROR_REPORTER_FLOW = "error-reporter";

/** The flow of the reporter's intake. A board dispatches an errored task's occurrence to it. */
export const ERROR_REPORTER_INTAKE_FLOW = "error-reporter-intake";

/** The intake's internal entry. */
export const INTAKE_ENTRY = "intake";

/** The intake's session: the reporter's own, and the key of each board's child session. */
export const INTAKE_SESSION_ID = "error-report-intake";
