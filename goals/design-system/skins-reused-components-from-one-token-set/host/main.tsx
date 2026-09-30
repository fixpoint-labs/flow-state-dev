/**
 * The goal's host page: every swept part, in every state that carries a colour.
 *
 * Copied into a host app that installed the registry with `fsdev ui add`. It
 * imports only what the host installed (`@/components/flow-state/*`) and the
 * chrome from `@flow-state-dev/react`, and adds no CSS of its own: the
 * stylesheet is the host's `app/globals.css`, plus App Lab's theme when the
 * URL asks for it.
 *
 * Each part is a `[data-part]` section. `data-means` marks the parts whose
 * meaning the check grades: `attention` where a person must act, `warning`
 * where something is off and nobody is asked. The grading lives in `run.mts`;
 * this page only renders.
 *
 *   ?theme=app-lab   load `app/themed.css` (globals + the App Lab stylesheet)
 *   ?dark=1          put `.dark` on <html> before the first render
 */
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { FlowProvider, FlowNavigator, Roster, BoardColumns, BoardList, SeatDetail } from "@flow-state-dev/react";
import type { OutputItem } from "@flow-state-dev/core/items";

import { Message } from "@/components/flow-state/message";
import { Reasoning } from "@/components/flow-state/reasoning";
import { CodeBlock } from "@/components/flow-state/code-block";
import { Tool, ToolGroup, ToolHeader, ToolShell, type ToolState } from "@/components/flow-state/tool";
import { Approval } from "@/components/flow-state/approval";
import { TaskPlan } from "@/components/flow-state/task-plan";
import { AuditAnnotation } from "@/components/flow-state/audit-annotation";
import { StuckRequestBanner } from "@/components/flow-state/stuck-request-banner";
import { FileTree, FileTreeFile, FileTreeFolder } from "@/components/flow-state/file-tree";
import { Form } from "@/components/flow-state/form";
import { Question } from "@/components/flow-state/question";
import { Debate } from "@/components/flow-state/debate";
import { EventedActors } from "@/components/flow-state/evented-actors";
import { RoutedSpecialists } from "@/components/flow-state/routed-specialists";
import { SessionItemsProvider } from "@/components/flow-state/session-items-context";

import * as f from "./fixtures";

const params = new URLSearchParams(location.search);
if (params.get("dark") === "1") document.documentElement.classList.add("dark");
if (params.get("theme") === "app-lab") await import("./app/themed.css");
else await import("./app/globals.css");

/** One swept part. `component` names the registry file the part exists to exercise. */
function Part(props: { name: string; component: string; means?: "attention" | "warning"; children: ReactNode }) {
  return (
    <section data-part={props.name} data-component={props.component} data-means={props.means} style={{ margin: 12 }}>
      {props.children}
    </section>
  );
}

// --- stream fixtures -------------------------------------------------------

const approvalItem = f.suspension({ suspensionId: "s-approve", message: "Send the drafted email?" });
const approvedItem = f.suspension({ suspensionId: "s-approved", message: "Refund the order?" });
const rejectedItem = f.suspension({ suspensionId: "s-rejected", message: "Delete the account?" });
const formItem = f.suspension({
  suspensionId: "s-form",
  reason: "human_input",
  message: "Before we route this ticket:",
  resumeSchema: {
    type: "object",
    properties: {
      comments: { type: "string", title: "What went wrong?" },
      priority: { type: "string", enum: ["low", "high"], title: "How urgent?" },
    },
    required: ["priority"],
  },
  allow: ["submit", "skip"],
});
const formDoneItem = f.suspension({ ...formItem, suspensionId: "s-form-done" } as never);
const questionItem = f.suspension({
  suspensionId: "s-question",
  reason: "human_input",
  message: "What is the deadline?",
  resumeSchema: { type: "string", minLength: 1 },
  allow: ["submit"],
});
const questionDoneItem = f.suspension({
  suspensionId: "s-question-done",
  reason: "human_input",
  message: "Which region?",
  resumeSchema: { type: "string", minLength: 1 },
  allow: ["submit"],
});

const debateLive = f.debate("req-debate-live", false);
const debateDone = f.debate("req-debate-done", true);
const actorsLive = f.eventedActors("req-ea-live", false);
const actorsDone = f.eventedActors("req-ea-done", true);
const routedLive = f.routedSpecialists("req-rs-live", false);
const routedDone = f.routedSpecialists("req-rs-done", true);

const task = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ id, goal: `A ${status} task`, status, ...extra });
const boards: Array<{ name: string; means?: "attention" | "warning"; items: OutputItem[] }> = [
  { name: "task-plan:parked", means: "attention", items: f.board("b-parked", "active", [task("t1", "parked")]) },
  {
    name: "task-plan:blocked",
    means: "warning",
    items: f.board("b-blocked", "active", [task("t2", "blocked", { feedback: "Needs the schema first.", attempts: 2 })]),
  },
  { name: "task-plan:in-progress", items: f.board("b-running", "active", [task("t3", "in_progress")]) },
  { name: "task-plan:completed", items: f.board("b-done", "active", [task("t4", "completed")]) },
  { name: "task-plan:errored", items: f.board("b-error", "active", [task("t5", "errored", { error: "It threw." })]) },
  { name: "task-plan:board-planning", means: "warning", items: f.board("b-planning", "planning", [task("t6", "pending")]) },
  { name: "task-plan:board-replanning", means: "warning", items: f.board("b-replanning", "replanning", [task("t7", "pending")]) },
  { name: "task-plan:board-reviewing", items: f.board("b-reviewing", "reviewing", [task("t8", "pending")]) },
];

const sessionItems: OutputItem[] = [
  approvalItem,
  approvedItem,
  rejectedItem,
  formItem,
  formDoneItem,
  questionItem,
  questionDoneItem,
  f.resume("s-approved", "approved"),
  f.resume("s-rejected", "rejected"),
  f.resume("s-form-done", "submitted"),
  f.resume("s-question-done", "submitted"),
  ...debateLive.items,
  ...debateDone.items,
  ...actorsLive.items,
  ...actorsDone.items,
  ...routedLive.items,
  ...routedDone.items,
  ...boards.flatMap((b) => b.items),
];

const toolStates: Array<[ToolState, "attention" | "warning" | undefined]> = [
  ["pending", undefined],
  ["running", undefined],
  ["awaiting", "attention"],
  ["completed", undefined],
  ["error", undefined],
  ["denied", "warning"],
];

// --- chrome fixtures -------------------------------------------------------

const flows = [
  { id: "support", kind: "support", cardinality: "singleton", requireUser: false, actions: [] },
  { id: "agent-billing", kind: "agent", cardinality: "collection", requireUser: false, actions: [] },
  { id: "agent-triage", kind: "agent", cardinality: "collection", requireUser: false, actions: [] },
];
const sessions = [
  { id: "sess-1", flowKind: "support", flowId: "support", userId: "demo", title: "Refund for order 118", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
  { id: "sess-2", flowKind: "support", flowId: "support", userId: "demo", title: "Password reset", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
];
const flowClient = { listFlows: async () => flows } as never;
const sessionClient = { listSessions: async () => sessions } as never;

const seats = [
  { topic: "billing", clientData: { seatId: "billing", flow: "agent", instructions: "Handle refunds." } },
  { topic: "triage", clientData: { seatId: "triage", flow: "agent", instructions: null } },
];
const cards = ["pending", "in_progress", "parked", "blocked", "completed"].map((status, i) => ({
  topic: `card-${i}`,
  clientData: { id: `card-${i}`, status, title: `Card ${status}`, assignee: i % 2 ? "billing" : undefined },
}));
const rosterSource = { listCollectionItems: async () => ({ items: seats }) };
const boardSource = { listCollectionItems: async () => ({ items: cards }) };
const seatSource = { getCollectionItemState: async () => seats[0] };

// --- page --------------------------------------------------------------------

function Page() {
  return (
    <FlowProvider flowKind="demo" userId="demo" baseUrl="">
      <SessionItemsProvider value={sessionItems}>
        <main className="bg-background text-foreground" style={{ padding: 12, width: 760 }}>
          <Part name="message:assistant" component="message.tsx">
            <Message item={f.message("assistant", "Here is the **plan**, with `code` and a [link](https://example.com).")} />
          </Part>
          <Part name="message:user" component="message.tsx">
            <Message item={f.message("user", "Can you refund order 118?")} />
          </Part>
          <Part name="reasoning:done" component="reasoning.tsx">
            <Reasoning item={f.reasoning("Checked the order history.", "completed")} />
          </Part>
          <Part name="reasoning:streaming" component="reasoning.tsx">
            <Reasoning item={f.reasoning("Checking the order", "in_progress")} />
          </Part>
          <Part name="code-block" component="code-block.tsx">
            <CodeBlock code={"const total = 42;\nexport default total;"} language="ts" />
          </Part>

          {toolStates.map(([state, means]) => (
            <Part key={state} name={`tool:${state}`} component="tool.tsx" means={means}>
              <ToolShell defaultOpen={false}>
                <ToolHeader name="refund_order" state={state} />
              </ToolShell>
            </Part>
          ))}
          <Part name="tool:item" component="tool.tsx">
            <Tool item={f.tool("web_search", { query: "refund policy" }, { results: 3 }, "completed")} />
          </Part>
          <Part name="tool:group-error" component="tool.tsx">
            <ToolGroup
              defaultOpen
              items={[
                f.tool("fetch_url", { url: "https://example.com" }, { ok: true }, "completed"),
                f.tool("fetch_url", { url: "https://example.com/missing" }, { error: "404" }, "failed"),
              ]}
            />
          </Part>

          <Part name="approval:pending" component="approval.tsx">
            <Approval item={approvalItem} />
          </Part>
          <Part name="approval:approved" component="approval.tsx">
            <Approval item={approvedItem} />
          </Part>
          <Part name="approval:rejected" component="approval.tsx">
            <Approval item={rejectedItem} />
          </Part>

          {boards.map((b) => (
            <Part key={b.name} name={b.name} component="task-plan.tsx" means={b.means}>
              <TaskPlan collectionId={(b.items[0] as { data: { collectionId: string } }).data.collectionId} />
            </Part>
          ))}

          <Part name="audit:info" component="audit-annotation.tsx">
            <AuditAnnotation item={f.audit("info")} />
          </Part>
          <Part name="audit:warning" component="audit-annotation.tsx" means="warning">
            <AuditAnnotation item={f.audit("warning")} />
          </Part>
          <Part name="audit:critical" component="audit-annotation.tsx">
            <AuditAnnotation item={f.audit("critical")} />
          </Part>

          <Part name="stuck-request-banner" component="stuck-request-banner.tsx" means="warning">
            <StuckRequestBanner session={{ isStuck: true, dismissRequest: async () => {} }} />
          </Part>

          <Part name="file-tree" component="file-tree.tsx">
            <FileTree defaultExpanded={new Set(["src"])} selectedPath="src/index.ts">
              <FileTreeFolder path="src" name="src">
                <FileTreeFile path="src/index.ts" name="index.ts" />
                <FileTreeFolder path="src/lib" name="lib" />
              </FileTreeFolder>
            </FileTree>
          </Part>

          <Part name="form:pending" component="form.tsx">
            <Form item={formItem} />
          </Part>
          <Part name="form:submitted" component="suspension-card-shell.tsx">
            <Form item={formDoneItem} />
          </Part>
          <Part name="question:pending" component="question.tsx">
            <Question item={questionItem} />
          </Part>
          <Part name="question:submitted" component="suspension-card-shell.tsx">
            <Question item={questionDoneItem} />
          </Part>

          <Part name="debate:live" component="debate.tsx">
            <Debate item={debateLive.item} />
          </Part>
          <Part name="debate:finished" component="debate.tsx">
            <Debate item={debateDone.item} />
          </Part>
          <Part name="evented-actors:live" component="evented-actors.tsx">
            <EventedActors item={actorsLive.item} />
          </Part>
          <Part name="evented-actors:finished" component="evented-actors.tsx">
            <EventedActors item={actorsDone.item} />
          </Part>
          <Part name="routed-specialists:live" component="routed-specialists.tsx">
            <RoutedSpecialists item={routedLive.item} />
          </Part>
          <Part name="routed-specialists:done" component="routed-specialists.tsx">
            <RoutedSpecialists item={routedDone.item} />
          </Part>

          <Part name="navigator" component="FlowNavigator">
            <FlowNavigator
              sections={[
                { label: "Channels", kinds: ["support"] },
                { label: "Seats", kinds: ["agent"] },
              ]}
              selectedSessionId="sess-1"
              onSelectSession={() => {}}
              client={flowClient}
              sessionClient={sessionClient}
              userId="demo"
            />
          </Part>
          <Part name="roster" component="Roster">
            <Roster sessionId="sess-1" resourceClient={rosterSource} />
          </Part>
          <Part name="board-columns" component="BoardColumns">
            <BoardColumns sessionId="sess-1" boardRef="support.queue" resourceClient={boardSource} />
          </Part>
          <Part name="board-list" component="BoardList">
            <BoardList sessionId="sess-1" boardRef="support.queue" resourceClient={boardSource} />
          </Part>
          <Part name="seat-detail" component="SeatDetail">
            <SeatDetail sessionId="sess-1" kind="agent" seatId="billing" resourceClient={seatSource} />
          </Part>
        </main>
      </SessionItemsProvider>
    </FlowProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Page />
  </StrictMode>
);
