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
    "src/components/ToolLine.tsx": ["CallRunSegment"],
    "src/components/TurnComposer.tsx": ["TurnSendState"],
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
    "src/lib/derive.ts": ["Roster", "WorkerState", "WorkerStates", "ShiftCounts", "ShiftCoordinator"],
    "src/lib/feed-health.ts": ["ReportFeed"],
    "src/lib/first-run.ts": ["StarterDelegate"],
    "src/lib/inbox.ts": ["ReviewData"],
    "src/lib/lab-data.tsx": ["LabData"],
    "src/lib/messages.ts": ["MessageExchange"],
    "src/lib/projects.ts": ["ProjectAddress"],
    "src/lib/roster.ts": ["RosterRead"],
    "src/lib/routes.ts": ["ProjectTab", "TaskTab", "TaskGrouping", "Route"],
    "src/lib/routines.ts": ["RoutineChange"],
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
