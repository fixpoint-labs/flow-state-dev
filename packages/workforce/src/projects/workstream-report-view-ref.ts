// FIX-2624.
/**
 * The client's handle on the roster flow's `workstreamReport` view: one
 * workstream entry's latest report, read with no session. Holds no block, so
 * it is safe in a browser bundle.
 */
import { viewRef } from "@flow-state-dev/client";
import { ROSTER_FLOW, WORKSTREAM_REPORT_VIEW } from "../workers/keys";
import type { WorkstreamReportView } from "./workstream-report-view";

/** One entry's report, for `client.view(workstreamReportView, { project, owner, id })`. Its answer is `{ report }`. */
export const workstreamReportView = viewRef<WorkstreamReportView>(ROSTER_FLOW, WORKSTREAM_REPORT_VIEW);
