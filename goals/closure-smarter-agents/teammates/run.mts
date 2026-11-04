/**
 * Goal check: the closure's seven asks in the Teammates lab (FIX-2541). A user
 * of the lab asks Chief of Staff the date, a one-line question, a task its
 * skill fits, a code change, and (after a long conversation) a decision made
 * at its start; and asks researcher a multi-file question and a knowledge
 * question over the working folder. Each reply is graded on what the user
 * sees and the records the lab keeps. See goal.md for the contract.
 *
 * Real path, real model: the lab served by `fsdev serve` from its folder on a
 * fresh SQLite store, its working folder a scratch git checkout holding the
 * draw's files, every ask over the public client. The coder ask runs Claude
 * Code and needs its sign-in.
 *
 * Run:  GOAL_PASS=cut pnpm tsx goals/closure-smarter-agents/teammates/run.mts
 *       GOAL_PASS=control (serves 0df5c85) · GOAL_PASS=wrap (sets nothing)
 *       GOAL_ASKS=date,sizing (a subset) · GOAL_RUNS · GOAL_FOLD_TURNS_MAX
 */
import { join } from "node:path";
import { askAfterFold, askWorker, clientFor, gitRepository, heldSkills, runChecks, runClosure, serveFsdev, skillFiles, type AppDriver } from "../closure.mts";

const USER = "u_closure";
const LEAD = "teammates.chief-of-staff";
const RESEARCHER = "teammates.researcher";
const lab = (root: string) => join(root, "labs", "teammates");
const tree = (root: string) => join(lab(root), "workforce");

const driver: AppDriver = {
  app: "teammates",
  plant: (d, p) => skillFiles(join(tree(p.root), "teams", "teammates", "workers", "chief-of-staff"), d.skill, p.switches),
  start: async (d, p, scratch) => {
    const store = join(scratch, "teammates.sqlite");
    // The working folder: a git checkout holding the draw's files and the coder ask's failing check.
    const workdir = gitRepository(join(scratch, "workdir"), { ...d.files, [d.coder.file]: d.coder.script });
    const served = await serveFsdev({
      root: p.root,
      cwd: lab(p.root),
      logTo: join(scratch, "server.log"),
      env: {
        TEAMMATES_STORE: store,
        TEAMMATES_USER: USER,
        TEAMMATES_WORKDIR: workdir,
        TEAMMATES_HARNESS: "claude-code",
        // Teammates' checks: `main` names none, so the control and the cut run name the fixture's.
        ...(p.switches ? { TEAMMATES_CHECKS: d.coder.check } : {}),
      },
    });
    const fsd = clientFor(served.origin, USER);
    const lead = (line: string, budgetMs?: number) => askWorker(fsd, { user: USER, worker: LEAD, line, ...(budgetMs === undefined ? {} : { budgetMs }) });
    return {
      stop: served.stop,
      asks: {
        date: (d) => lead(d.lines.date),
        sizing: (d) => lead(d.lines.sizing),
        skill: async (d) => ({ ...(await lead(d.lines.skill)), held: await heldSkills(tree(p.root), LEAD) }),
        multiFile: (d) => askWorker(fsd, { user: USER, worker: RESEARCHER, line: d.lines.multiFile }),
        knowledge: (d) => askWorker(fsd, { user: USER, worker: RESEARCHER, line: d.lines.knowledge }),
        coder: async (d) => {
          const turn = await lead(`${d.lines.coder} Hand it to Claude Code.`, 30 * 60_000);
          return { ...turn, checks: runChecks(store) };
        },
        fold: (d) => askAfterFold(fsd, { user: USER, worker: LEAD, d }),
      },
    };
  },
};

await runClosure(driver);
