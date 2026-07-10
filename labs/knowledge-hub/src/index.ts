// ---------------------------------------------------------------------------
// @flow-state-dev/knowledge-hub — lab barrel (FIX-882).
//
// Re-exports the capture flow plus the inbox collection, its record schema, and
// the pure mailroom helpers — the surface the FIX-883 sweeper consumes. The
// sweeper (routing into long-term memory) and the FIX-884 workforce roster land
// in the follow-on issues.
// ---------------------------------------------------------------------------

export { default as knowledgeHubFlow } from "./flow";
export {
  activityKindSchema,
  inboxCollection,
  inboxRecordSchema,
  inboxKey,
  inboxIdFromPath,
  INBOX_PREFIX,
  type ActivityKind,
  type InboxRecord,
} from "./inbox";
export { normalizeForFingerprint, computeFingerprint } from "./mailroom";
