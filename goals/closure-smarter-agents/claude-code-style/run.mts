/**
 * Goal check: the closure's seven asks in the Claude Code-style lab
 * (FIX-2541). A user of the lab asks the main session, set to a project, the
 * date, a one-line question, a task its skill fits, a question whose answer
 * sits in three of the project's files, and a code change (which it hands to
 * a coding run); asks researcher a knowledge question over the project; and
 * at the wrap only, after a long conversation, a decision made at its start.
 * See goal.md for the contract.
 *
 * The lab has no summary fold to switch on, so the fold ask runs here at the
 * wrap alone; on the control and the cut run it counts on Teammates
 * (`asks.mts` → `cellsFor`).
 *
 * Real path, real model: the lab served by `fsdev serve` from its own config
 * on a fresh data folder, its project a scratch `file://` repository holding
 * the draw's files, every ask over the public client. The coder ask runs
 * Claude Code and needs its sign-in, or, on Haiku (`GOAL_HAIKU=1`), the key
 * every other ask runs on (`../model.mts`).
 *
 * Run:  GOAL_PASS=cut pnpm tsx goals/closure-smarter-agents/claude-code-style/run.mts
 *       GOAL_PASS=control (serves 0df5c85) · GOAL_PASS=wrap (sets nothing) · GOAL_HAIKU=1 (on Haiku)
 *       GOAL_ASKS=date,sizing (a subset) · GOAL_RUNS · GOAL_FOLD_TURNS_MAX
 */
import { join } from "node:path";
import { createWorkforceClient, SET_SESSION_FIELDS_ACTION } from "@flow-state-dev/workforce/browser";
import { REPO_ROOT } from "../../lib/index.mts";
import { act, askAfterFold, askWorker, clientFor, coderRepository, heldSkills, runClosure, serveFsdev, settledRunChecks, skillFiles, type AppDriver } from "../closure.mts";

const USER = "u_closure";
const MAIN = "desk.main";
const RESEARCHER = "desk.researcher";
const lab = (root: string) => join(root, "labs", "claude-code-style");
const tree = (root: string) => join(lab(root), "workforce");

const driver: AppDriver = {
  app: "claude-code-style",
  plant: (d, p) => skillFiles(join(tree(p.root), "teams", "desk", "workers", "main"), d.skill, p.switches),
  start: async (d, p, scratch) => {
    const data = join(scratch, "data");
    const repo = coderRepository(join(scratch, "repo"), d, p.model);
    const served = await serveFsdev({
      root: p.root,
      cwd: p.root,
      args: ["--config", join(lab(p.root), "fsdev.config.mts")],
      logTo: join(scratch, "server.log"),
      // The host's checks are the operator's data, as Teammates' working folder's are: a fixture, not a switch.
      env: { CLAUDE_CODE_STYLE_DATA: data, CLAUDE_CODE_STYLE_USER: USER, CLAUDE_CODE_STYLE_CHECKS: d.coder.check },
      model: p.model,
    });
    const fsd = clientFor(served.origin, USER);
    const workforce = createWorkforceClient(fsd);
    const projectId = "closure";
    const projects = (await fsd.flow("projects").createSession()).id;
    // An older tree (the control's commit) reads its checks off the project instead of the host.
    const projectChecks = p.root === REPO_ROOT ? {} : { checks: [d.coder.check] };
    await act(fsd, "projects", projects, "createProject", { id: projectId, title: "Closure", visibility: "private", repository: `file://${repo}`, ...projectChecks });
    const project = { visibility: "private" as const, id: projectId };
    /** A fresh session of `worker`, set to the project and opened on its repository, as the lab's open does. */
    const sessionOf = async (worker: string) => {
      const id = (await fsd.flow("agent").createSession({ state: { workerId: worker } })).id;
      await workforce.setWorkProject(worker, project, { sessionId: id });
      // An older tree (the control's commit) finds its repository through the project, and has no session repository.
      if (p.root === REPO_ROOT) await act(fsd, "agent", id, SET_SESSION_FIELDS_ACTION, { worker, fields: { repository: `file://${repo}` } });
      return id;
    };
    const main = async (line: string, budgetMs?: number) =>
      askWorker(fsd, { user: USER, worker: MAIN, sessionId: await sessionOf(MAIN), line, ...(budgetMs === undefined ? {} : { budgetMs }) });
    return {
      asks: {
        date: (d) => main(d.lines.date),
        sizing: (d) => main(d.lines.sizing),
        skill: async (d) => ({ ...(await main(d.lines.skill)), held: await heldSkills(tree(p.root), MAIN) }),
        multiFile: (d) => main(d.lines.multiFile),
        knowledge: async (d) => askWorker(fsd, { user: USER, worker: RESEARCHER, sessionId: await sessionOf(RESEARCHER), line: d.lines.knowledge }),
        coder: async (d) => ({ ...(await main(d.lines.coder, 30 * 60_000)), ...(await settledRunChecks(join(data, "lab.db"))) }),
        fold: (d) => askAfterFold(fsd, { user: USER, worker: MAIN, d }),
      },
    };
  },
};

await runClosure(driver);
