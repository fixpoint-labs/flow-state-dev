/**
 * The copy for every surface that has no shipped read yet: where it will be,
 * what arrives there, and who ships it. Passed to each surface as a prop, so
 * the issue that fills a surface replaces its entry here and nothing else.
 */
export const GAPS = {
  inReview: "What counts as in review arrives with FIX-1651.",
  now: "What a task is doing now arrives with FIX-1651.",
  harness: "Which harness a worker runs arrives with FIX-1652.",
  cost: "A task's cost arrives with FIX-1652.",
  /**
   * The task screen's gaps (FIX-1664's gap registry, BUSINESS-RULES.md): each
   * names what arrives and who ships it, or says it is not planned in the
   * first cut. When an owner ships, its entry here changes and nothing else.
   */
  task: {
    alsoPost: "Posting a task's message to its workstream too arrives with FIX-1474.",
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
    recordsNoPullRequests: "This harness records no pull requests. Reading a run that records none arrives with FIX-1652.",
    briefFields: "This board doesn't publish a task's context or input to a browser, so only its title and goal show here. Showing them is not planned in the first cut.",
  },
  /**
   * Why a message to a worker can't be sent (FIX-1690's rules). Not gaps that
   * an owner fills: each is the answer for a state a task or a worker is in. A
   * line that takes the worker's name is drawn after it.
   */
  turn: {
    /** BR-14: the row has no linked run. */
    notStarted: "This task hasn't started, so there's no session to write into.",
    /** The run's worker flow declares no door. Drawn after the worker's name. */
    noDoor: "takes no message.",
    /** BR-22: Inbox's reply, to a worker flow with no door. Drawn after the worker's name. */
    replyNoDoor: "takes no message. Answer its ask with Approve or Reject.",
  },
  /** Roster's gaps, and the partial mark every status screen shares (FIX-1723). */
  roster: {
    workerMatch:
      "Which worker holds a task is a best match on the task's assignee: its id, then a unique name. A task whose assignee matches no single worker counts for no one. A declared map arrives with FIX-1672.",
    partial: "Asks did not load, so on shift may be missing workers waiting on you.",
  },
  /** The Shift Coordinator view's named states (BR-11, BR-12). */
  shiftCoordinator: {
    /** BR-11: the Lab's inventory holds no shift-coordinator worker. */
    none: {
      title: "This Lab declares no shift coordinator",
      body: "Shift Manager talks to the worker named shift-coordinator. Declare one on the coordinator flow at org/workers/shift-coordinator/.",
    },
    /** BR-12: drawn before the workers' ids. */
    several: "More than one worker is named shift-coordinator, so Shift Manager talks to neither:",
  },
  resources: "This Lab serves no documents to the browser, so there is nothing to open here yet.",
  inboxScope:
    "Inbox lists the asks in sessions you started, and in the runs those started. Asks in another user's sessions are not listed; an organization-wide view is FIX-1652's call.",
} as const;

export type Gaps = typeof GAPS;
