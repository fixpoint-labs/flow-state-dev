/**
 * Shift Manager's settings for the shared inventory
 * (`labs/test-support/inventory.mts`): the content rules (L3, L4 over all of
 * `src/`, own sessions), the read model that goes, and the types its screen
 * computes itself. `inventory.test.ts` runs them against
 * `inventory-allowlist.json`, which only shrinks. Shift Manager is a
 * published app over another host's Lab, so the path classes and caps (L1,
 * L2, H), which describe a starter, don't apply.
 */
import type { AppInventory } from "../../../labs/test-support/inventory.mts";

export const shiftManager: AppInventory = {
  path: "packages/shift-manager",
  entry: "src/lib/connection.ts",
  rules: ["L3", "L4", "own sessions"],
  gone: ["src/lib/reads.ts"],
  /** A snapshot is the read model's by definition: never one the screen computes. */
  neverScreen: /Snapshot$/,
  /** What is left of the read model: it may not grow. */
  readModel: ["src/lib/reads.ts"],
  /**
   * The types the screen computes itself, by the module that exports them.
   * A type stays on the allowlist when it hand-writes the shape of something
   * the server computes or stores: a row, a read's result, a request's
   * outcome, or the callbacks of a hand-built read or stream. It is listed
   * here when the screen computes it (a route, the theme, a component's
   * props, UI state, counts, a hook's output assembled from several reads,
   * entries drawn from stored items) or when it is taken from a package's
   * own type (a view's value, an action's output). A type that leaves the
   * allowlist for this list names its reason ({ name, reason }).
   */
  screenTypes: {
    "src/gaps.ts": ["Gaps"],
    "src/components/TurnComposer.tsx": ["TurnSendState"],
    "src/components/TurnLines.tsx": ["TurnLineActions"],
    "src/components/flow-state/attachments.tsx": [
      "AttachmentUploader", "AttachmentRefusal", "PendingAttachment", "AttachmentLimitOverrides", "UseAttachmentsOptions",
      "Attachments", "AttachmentPreviewProps", "AttachmentStripProps", "AttachButtonProps",
    ],
    "src/components/flow-state/code-block.tsx": [
      "CodeBlockCopyButtonProps", "CodeBlockLanguageSelectorProps", "CodeBlockLanguageSelectorTriggerProps",
      "CodeBlockLanguageSelectorValueProps", "CodeBlockLanguageSelectorContentProps", "CodeBlockLanguageSelectorItemProps",
    ],
    "src/components/flow-state/connection-screen.tsx": ["ConnectionFailure"],
    "src/components/flow-state/conversation.tsx": [
      "ConversationProps", "ConversationContentProps", "ConversationEmptyStateProps", "ConversationScrollButtonProps",
      "ConversationMessage", "ConversationDownloadProps",
    ],
    "src/components/flow-state/error.tsx": ["ErrorBodyProps"],
    "src/components/flow-state/message-response.tsx": ["MessageResponseProps"],
    "src/components/flow-state/message.tsx": [
      "MessageProps", "MessageContentProps", "MessageActionsProps", "MessageActionProps", "MessageBranchProps",
      "MessageBranchContentProps", "MessageBranchSelectorProps", "MessageBranchPreviousProps", "MessageBranchNextProps",
      "MessageBranchPageProps", "MessageToolbarProps", "ReadMessageFile",
    ],
    "src/components/flow-state/reasoning.tsx": ["ReasoningProps", "ReasoningTriggerProps", "ReasoningContentProps"],
    "src/components/flow-state/request-recovery.tsx": ["FailedRequestProps", "InterruptedRequestProps", "StoppedRequestProps", "RequestRecoveryProps"],
    "src/components/flow-state/review-hold.tsx": ["ReviewDetail", "ReviewAnswer", { name: "LandedWork", reason: "a registry copy, byte-equal to its packages/ui source (static.test.ts); the registry ships without harness-manager, so it inlines LandedWork" }],
    "src/components/flow-state/run-changes.tsx": ["RunChangesFile", "RunChangesPatch", "RunChangesProps"],
    "src/components/flow-state/run-checks.tsx": ["RunChecksProps", { name: "RunCheck", reason: "a registry copy, byte-equal to its packages/ui source (static.test.ts); the registry ships without harness-manager, so it inlines its ReviewCheck" }],
    "src/components/flow-state/shimmer.tsx": ["TextShimmerProps"],
    "src/components/flow-state/spend.tsx": ["SpendLineOptions", { name: "SpendSummary", reason: "a registry copy, byte-equal to its packages/ui source (static.test.ts); the registry ships without orchestration, so it inlines its TaskSpendView" }],
    "src/components/flow-state/task-actions.tsx": ["TaskRerunOption", { name: "TaskActionCalls", reason: "a registry copy, byte-equal to its packages/ui source (static.test.ts); the registry ships without orchestration, so it inlines its BoardActions" }],
    "src/components/flow-state/task-plan-state.ts": [
      "TaskEntry", "TaskPlanState", "StatusGroup", "AssigneeGroup",
      { name: "TaskStatus", reason: "a registry copy, byte-equal to its packages/ui source (static.test.ts); the registry ships without orchestration, so it inlines the substrate's TaskStatus (orchestration/tasks exports it)" },
      { name: "Task", reason: "a registry copy, byte-equal to its packages/ui source (static.test.ts); the registry ships without orchestration, so it inlines the substrate's Task (orchestration/tasks exports it)" },
      { name: "TaskChangeKind", reason: "a registry copy, byte-equal to its packages/ui source (static.test.ts); the registry ships without orchestration, so it inlines the substrate's TaskChangeKind (orchestration/tasks exports it)" },
      { name: "BoardCounts", reason: "a registry copy, byte-equal to its packages/ui source (static.test.ts); the registry ships without orchestration, so it inlines the substrate's TaskBoardCounts (orchestration/tasks exports it)" },
      { name: "BoardMeta", reason: "a registry copy, byte-equal to its packages/ui source (static.test.ts); the registry ships without orchestration, so it inlines the substrate's TaskBoardMeta (orchestration/tasks exports it)" },
    ],
    "src/components/flow-state/task-plan.tsx": ["StatusConfig", "TaskPlanProps"],
    "src/components/flow-state/tool-grouping.ts": ["ToolVerbs", "ToolCallLabelInput"],
    "src/components/flow-state/tool-naming.ts": ["ToolSubject"],
    "src/components/flow-state/tool-summaries.ts": ["ToolCallSummary"],
    "src/components/flow-state/tool.tsx": ["ToolInputProps", "ToolOutputProps", "ToolGroupProps", "ToolRowProps"],
    "src/lib/ask-session.ts": ["SessionCall", "SessionReply"],
    "src/lib/columns.ts": ["Column"],
    "src/lib/conversation-tasks.ts": ["ConversationTask"],
    "src/lib/conversation.ts": ["WorkerConversation"],
    "src/lib/directory-reads.ts": [
      { name: "CollectionRead", reason: "a useResource read of a whole collection as the directory holds it: its parsed values, its failure and its refresh" },
      { name: "Sessions", reason: "useSessionList's sessions as the directory holds them: the last list that landed, why the last list failed, and its refresh" },
      { name: "DirectoryReads", reason: "the directory's reads, one hook's output assembled from useResource, the roster watch and useSessionList" },
    ],
    "src/lib/directory.tsx": [{ name: "Workers", reason: "the worker directory a screen draws: the inventory joined with the roster (D1), a hook's output assembled from two reads" }],
    "src/lib/failure.ts": [
      { name: "Failure", reason: "react's own ViewReadFailure, the reason useView and useResource give a failed read" },
      { name: "Section", reason: "UI state: a section's value, or the failure its read gave, as a screen draws it" },
    ],
    "src/lib/gate.ts": [{ name: "Gate", reason: "UI state: whether the shell is in, refused or not reaching the Lab, computed from the organization read" }],
    "src/lib/feed-health.ts": ["ReportFeed"],
    "src/lib/first-run.ts": ["StarterDelegate"],
    "src/lib/inbox.ts": ["ReviewData"],
    "src/lib/lab-data.tsx": ["LabData"],
    "src/lib/messages.ts": ["MessageExchange"],
    "src/lib/project.ts": [
      { name: "Project", reason: "a projects row with where it lives, parsed by toProject so a row an earlier version wrote still reads (BP-030); the collection's client data names no visibility" },
    ],
    "src/lib/projects.ts": [
      "ProjectAddress",
      { name: "WorkstreamEntry", reason: "workforce's ParsedWorkstreamEntry with its storage key and whether it has gone quiet, which the screen works out by projectProgress's clock" },
      { name: "ProjectWorkstreams", reason: "a project's entries with the progress the screen works out from them (projectProgress): a hook's output, assembled" },
      { name: "ScreenRead", reason: "UI state: a hook's value, its failure and its refresh, as the project screens draw a read" },
    ],
    "src/lib/roster.ts": ["RosterRead"],
    "src/lib/routes.ts": ["ProjectTab", "TaskTab", "TaskGrouping", "Route"],
    "src/lib/routines.ts": ["RoutineChange"],
    "src/lib/shift.ts": [
      { name: "WorkerState", reason: "a worker's status, held tasks and asks, computed from the directory and the Inbox view (moved from derive.ts)" },
      { name: "WorkerStates", reason: "every worker's state, computed once from the directory and the Inbox view (moved from derive.ts)" },
      { name: "ShiftCounts", reason: "counts the screen computes over the worker states (moved from derive.ts)" },
      { name: "ShiftCoordinator", reason: "which worker is the Shift Coordinator, computed from the directory by name (moved from derive.ts)" },
    ],
    "src/lib/usage.ts": [
      { name: "HarnessUsage", reason: "the harness usage view's own row, taken from its value (ViewValueOf)" },
      { name: "UsageWindow", reason: "a window of the harness usage view's row, taken from its value (ViewValueOf)" },
      { name: "WorkerUsage", reason: "the worker usage view's own row, taken from its value (ViewValueOf)" },
      { name: "WorkerSourceUsage", reason: "a source of the worker usage view's row, taken from its value (ViewValueOf)" },
    ],
    "src/lib/workers.ts": [
      { name: "Worker", reason: "the joined worker (D1): an inventory row named and grouped by workerNames, with its roster entry's harness, or one of the user's own off their roster" },
      { name: "JoinedWorkers", reason: "the directory join's output: every worker and the user's own, assembled from two reads" },
    ],
    "src/lib/rules.ts": ["StandingRule", "RulesRead", "RuleEditInput", "StandingRulesView"],
    "src/lib/task.tsx": [
      "RunState", "InterruptState", "TaskView",
      { name: "OpenRun", reason: "the run the screen opens: the row's link and the flow its session names, assembled from two reads (moved from run.ts)" },
      { name: "OpenTask", reason: "the task-list view's row with each field it may leave out read as none, and the board it is on: the view's own type, assembled" },
    ],
    "src/lib/deliver.ts": [
      { name: "DeliveryWatch", reason: "what the composer holds of one session, from the shared feed and the turns view: the hook's input, assembled from two reads" },
      { name: "Delivery", reason: "where one send stands, computed by the screen from what it holds (D2's delivered)" },
      { name: "Delivered", reason: "what a delivered line came to: the request id the send answered, and the stop the screen derived" },
    ],
    "src/lib/theme.ts": ["ThemeLook"],
  },
};
