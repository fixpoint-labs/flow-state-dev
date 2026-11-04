/**
 * Goal check: the closure's asks in Shift Manager (FIX-2541), over its
 * DevTeam Lab. A person working the Lab asks the Shift Coordinator the date,
 * a one-line question and a task a skill fits; asks the researcher a
 * multi-file question and a knowledge question over a project; and asks the
 * EM for a change in that project, which it files for the coder. Shift
 * Manager runs no fold ask (the labs only). See ../goal.md for the contract.
 *
 * Real path, real model: the DevTeam Lab's own `fsdev.config.mts` (what the
 * `shift-manager` command serves under its pages) served by `fsdev serve` on a
 * fresh SQLite store, with Claude Code as its coder, every ask over the Lab's
 * public routes as its owner, with the owner's bearer as the page carries it.
 * The project is a scratch `file://` repository holding the draw's files and
 * the coder ask's failing check, created through the Lab's `projects` flow.
 * The coder ask needs a Claude Code sign-in.
 *
 * Run:  GOAL_PASS=cut pnpm tsx goals/closure-smarter-agents/shift-manager/run.mts
 *       GOAL_PASS=control (serves 0df5c85) · GOAL_PASS=wrap (sets nothing)
 *       GOAL_ASKS=date,sizing (a subset) · GOAL_RUNS
 */
import { join } from "node:path";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";
import { LAB_USERS } from "../../../packages/shift-manager/teams/devteam/host.mts";
import { act, askWorker, clientFor, gitRepository, heldSkills, runChecks, runClosure, serveFsdev, skillFiles, type AppDriver } from "../closure.mts";

const OWNER = LAB_USERS.owner;
// Organization-level workers carry no team prefix.
const COORDINATOR = "shift-coordinator";
const RESEARCHER = "researcher";
const EM = "eng.em";
const team = (root: string) => join(root, "packages", "shift-manager", "teams", "devteam");
const tree = (root: string) => join(team(root), "workforce");

const driver: AppDriver = {
  app: "shift-manager",
  plant: (d, p) => skillFiles(join(tree(p.root), "org", "workers", "shift-coordinator"), d.skill, p.switches),
  start: async (d, p, scratch) => {
    const store = join(scratch, "devteam.sqlite");
    const repo = gitRepository(join(scratch, "repo"), { ...d.files, [d.coder.file]: d.coder.script });
    const served = await serveFsdev({
      root: p.root,
      cwd: team(p.root),
      args: ["--config", join(team(p.root), "fsdev.config.mts")],
      logTo: join(scratch, "server.log"),
      env: { DEVTEAM_STORE: store, DEVFORCE_LAB_HARNESS: "claude-code" },
    });
    const fsd = clientFor(served.origin, OWNER.userId, OWNER.bearer);
    const projectId = "closure";
    const project = { visibility: "shared" as const, id: projectId };
    const projects = (await fsd.flow("projects").createSession()).id;
    // The project's checks are project data the coder's run reads, like its repository: a fixture, not a switch.
    await act(fsd, "projects", projects, "createProject", { ...project, title: "Closure", repository: `file://${repo}`, checks: [d.coder.check] });
    /** A fresh session of the researcher, set to the project. */
    const researcher = async (line: string) => {
      const sessionId = (await createWorkforceClient(fsd).ensureWorkerSession({ worker: RESEARCHER })).id;
      await createWorkforceClient(fsd).setWorkProject(RESEARCHER, project, { sessionId });
      return askWorker(fsd, { user: OWNER.userId, worker: RESEARCHER, sessionId, line });
    };
    const coordinator = (line: string) => askWorker(fsd, { user: OWNER.userId, worker: COORDINATOR, line });
    return {
      stop: served.stop,
      asks: {
        date: (d) => coordinator(d.lines.date),
        sizing: (d) => coordinator(d.lines.sizing),
        skill: async (d) => ({ ...(await coordinator(d.lines.skill)), held: await heldSkills(tree(p.root), COORDINATOR) }),
        multiFile: (d) => researcher(d.lines.multiFile),
        knowledge: (d) => researcher(d.lines.knowledge),
        coder: async (d) => {
          const turn = await askWorker(fsd, {
            user: OWNER.userId,
            worker: EM,
            line: `${d.lines.coder} The work is in the shared project "${projectId}".`,
            budgetMs: 30 * 60_000,
          });
          return { ...turn, checks: runChecks(store) };
        },
      },
    };
  },
};

await runClosure(driver);
