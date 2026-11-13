// FIX-2624.
/**
 * The workstream report view: one entry's latest report (the entry's content),
 * answered at user scope with no session.
 *
 * Who reads: a shared project's entries are the organization's, so anyone in
 * it reads any owner's report; a private project's address reaches only the
 * reader's own user scope. The same reach the entries' browser read gives.
 *
 * The client's handle is `workstreamReportView` (`workstream-report-view-ref.ts`).
 */
import { defineView, handler, type ViewDefinition } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";
import { projectAddressSchema } from "./collections";
import { workstreamsAt } from "./project-address";
import { WORKSTREAM_RESOURCES, workstreamEntryKey } from "./workstream-collections";

/** What the view takes: the entry's project, its owner and its id. */
const workstreamReportInputSchema = z.object({ project: projectAddressSchema, owner: z.string().min(1), id: z.string().min(1) }).strict();

/** What it answers: the report, or `null` when the entry has none or there is no entry. */
const workstreamReportOutputSchema = z.object({ report: z.string().nullable() });

/** The workstream report view, as {@link defineWorkstreamReportView} builds it. Import as a type in client code. */
export type WorkstreamReportView = ViewDefinition<
  BlockDefinition<typeof workstreamReportInputSchema, typeof workstreamReportOutputSchema>,
  "user"
>;

/** The view. The roster flow installs it in its `views`. */
export function defineWorkstreamReportView(): WorkstreamReportView {
  return defineView({
    scope: "user",
    block: handler({
      name: "workforce-workstream-report",
      inputSchema: workstreamReportInputSchema,
      outputSchema: workstreamReportOutputSchema,
      resources: WORKSTREAM_RESOURCES,
      execute: async (input, ctx) => {
        const entry = await workstreamsAt(ctx, input.project.visibility).getOptional(
          workstreamEntryKey(input.project.id, input.owner, input.id)
        );
        const report = entry === undefined ? null : await entry.readContent();
        return { report: typeof report === "string" && report.length > 0 ? report : null };
      }
    })
  }) as WorkstreamReportView;
}
