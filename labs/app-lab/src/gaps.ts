/**
 * The copy for every surface that has no shipped read yet: where it will be,
 * what arrives there, and who ships it. Passed to each surface as a prop, so
 * the issue that fills a surface replaces its entry here and nothing else.
 */
export const GAPS = {
  projectStream: {
    title: "No project stream yet",
    body: "Projects arrive with FIX-1650. Until then every workstream is listed on its own under PROJECTS.",
  },
  projectBoard: {
    title: "No project board yet",
    body: "A project's board gathers its workstreams' boards once projects ship (FIX-1650).",
  },
  projectWorkstreams: {
    title: "No project holds a workstream yet",
    body: "Grouping workstreams into projects arrives with FIX-1650. The sidebar lists every workstream directly meanwhile.",
  },
  projectBrief: {
    title: "No project brief yet",
    body: "A project's brief arrives with FIX-1650.",
  },
  results: {
    title: "No results yet",
    body: "What a workstream has produced arrives with FIX-1651.",
  },
  progress: {
    title: "No progress read yet",
    body: "How far a workstream has got arrives with FIX-1651.",
  },
  inReview: "What counts as in review arrives with FIX-1651.",
  now: "What a task is doing now arrives with FIX-1651.",
  harness: "Which harness a seat runs arrives with FIX-1652.",
  cost: "A task's time and cost arrive with FIX-1651.",
  taskScreen: {
    title: "The task screen is not here yet",
    body: "Its session, diff, checks and brief arrive with FIX-1664, in this frame.",
  },
  taskInspector: {
    title: "No inspector yet",
    body: "The task's inspector arrives with FIX-1664, in this panel.",
  },
  addressWorker:
    "Addressing a worker with @ arrives with FIX-1664's session write. Until then a line can only be posted to the whole channel.",
  resources: "This Lab serves no documents to the browser, so there is nothing to open here yet.",
  inboxScope:
    "Inbox lists the asks in sessions you started, and in the runs those started. Asks in another member's sessions are not listed; an organization-wide view is FIX-1652's call.",
} as const;

export type Gaps = typeof GAPS;
