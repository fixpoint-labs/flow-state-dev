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
  /**
   * The task screen's gaps (FIX-1664's gap registry, BUSINESS-RULES.md): each
   * names what arrives and who ships it, or says it is not planned in the
   * first cut. When an owner ships, its entry here changes and nothing else.
   */
  task: {
    composer:
      "Not built yet: nothing sends your message into a running coding run. It is not planned in the first cut unless that operation is filed.",
    alsoPost:
      "Posting a task's message to its workstream too arrives with the same operation as typing to the worker, which is not planned in the first cut unless that operation is filed.",
    handOff: "Handing a task to another worker, reassigning it and opening its PR arrive with FIX-1651.",
    diff: {
      title: "No diff yet",
      body: "What a run changed arrives with FIX-1651. The edits it made show in the Session meanwhile.",
    },
    checks: {
      title: "No checks yet",
      body: "A run's checks arrive with FIX-1651.",
    },
    acceptance: "Acceptance criteria arrive with FIX-1651.",
    reviewBy: "Who reviews a task arrives with FIX-1651.",
    harness: "Which harness ran, its tokens and its cost arrive with FIX-1652. Nothing a browser can read carries them yet.",
    recordsNoPlan: "This harness records no plan. Reading a run that records none arrives with FIX-1652.",
    recordsNoFiles: "This harness records no file operations. Reading a run that records none arrives with FIX-1652.",
    briefFields: "This board doesn't publish a task's context or input to a browser, so only its title and goal show here. Showing them is not planned in the first cut.",
  },
  addressWorker:
    "Addressing one worker with @ isn't built yet: a coding worker takes no message while it runs. Until then a line can only be posted to the whole channel.",
  resources: "This Lab serves no documents to the browser, so there is nothing to open here yet.",
  inboxScope:
    "Inbox lists the asks in sessions you started, and in the runs those started. Asks in another member's sessions are not listed; an organization-wide view is FIX-1652's call.",
} as const;

export type Gaps = typeof GAPS;
