/**
 * The Error Reporter (FIX-1983): a worker that turns a failure that stayed
 * failed, or a problem a user describes, into one reproducible bug report,
 * previewed to the operator in Inbox and filed through the project's tracker.
 */
export {
  createErrorReporter,
  INTAKE_SESSION_ID,
  type ErrorReporter,
  type ErrorReporterHost,
  type ErrorReporterOperator,
  type ErrorReporterOptions,
  type FinalFailureEvent,
  type ReporterRunResult,
  type ReporterSessionFacts
} from "./reporter";
export {
  defineErrorReporterFlow,
  defineErrorReporterIntakeFlow,
  ERROR_REPORTER_FLOW,
  ERROR_REPORTER_INTAKE_FLOW,
  REPORT_SESSION_PREFIX,
  previewAnswerSchema,
  type ErrorReporterFlowOptions,
  type ErrorReporterIntakeFlowOptions,
  type ErrorReporterHarnessFeeds,
  type PreviewAnswer
} from "./flow";
export {
  DEFAULT_LIMITS,
  ERROR_REPORTS_RESOURCE,
  errorReportsCollection,
  intakeOccurrence,
  type IntakeDecision,
  type Occurrence,
  type ReportLimits,
  type ReportRow
} from "./reports";
export { fingerprintOf, normalizeErrorMessage, type FingerprintParts } from "./fingerprint";
export { redact, secretsFromEnv, REDACTED } from "./redact";
