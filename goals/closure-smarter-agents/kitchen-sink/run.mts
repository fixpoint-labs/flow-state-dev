/**
 * Goal check: the closure's asks in Kitchen Sink (FIX-2541). A user of the
 * Flow State page asks the support desk (`support.help`, which routes each
 * post to the specialist it fits) the date, a one-line question and a task
 * a skill fits; asks the flow-state-dev specialist (`support.fsd`) a question
 * whose answer needs three published doc pages, and a knowledge question;
 * and asks a Claude Code session to make a change. Kitchen Sink runs no fold
 * ask (the labs only). See ../goal.md for the contract.
 *
 * The multi-file ask cannot plant a fresh value in published docs, so each run
 * draws one question from a pool whose answer needs facts from three separate
 * pages, and passes only when every page was fetched in that turn and the
 * reply states each fact (`asks.mts` → `gradePagesRead`).
 *
 * Real path, real model: the app's own `fsdev.config.ts` served by
 * `fsdev serve` on its in-memory store (fresh each run, never the developer's
 * SQLite), its harness workspace a scratch git repository holding the coder
 * ask's failing check, every ask over the public client. The coder ask runs
 * Claude Code mode, which the app turns on only for a non-root server with a
 * Claude Code sign-in; where it is off, the ask fails its setup, naming the
 * app's reason.
 *
 * Run:  GOAL_PASS=cut pnpm tsx goals/closure-smarter-agents/kitchen-sink/run.mts
 *       GOAL_PASS=control (serves 0df5c85) · GOAL_PASS=wrap (sets nothing)
 *       GOAL_ASKS=date,sizing (a subset) · GOAL_RUNS
 */
import { join } from "node:path";
import { askWorker, clientFor, gitRepository, heldSkills, itemsOf, runClosure, serveFsdev, untilQuiet, skillFiles, turnChecks, turnOf, type AppDriver } from "../closure.mts";

/** Kitchen Sink's one user: its principal is a constant (`lib/kitchen-sink-principal.ts`). */
const USER = "devuser";
const DESK = "support.help";
const FSD = "support.fsd";
/** The desk's specialists: whichever one a post is routed to answers it, so each holds the skill. */
const SPECIALISTS = ["devices", "accounts", "fsd", "general"] as const;
const CLAUDE_CODE_FLOW = "claude-code-session";
const app = (root: string) => join(root, "apps", "kitchen-sink");
const tree = (root: string) => join(app(root), "workforce");
const workerDir = (root: string, name: string) => join(tree(root), "teams", "support", "workers", name);

const driver: AppDriver = {
  app: "kitchen-sink",
  // `@flow-state-dev/tools`' fetch block, as the specialist's tool calls record it.
  pageFetchTool: "fetch",
  plant: (d, p) => Object.assign({}, ...SPECIALISTS.map((name) => skillFiles(workerDir(p.root, name), d.skill, p.switches))),
  start: async (d, p, scratch) => {
    const repo = gitRepository(join(scratch, "repo"), { [d.coder.file]: d.coder.script });
    const served = await serveFsdev({
      root: p.root,
      // The app's directory: its config resolves `@/` through the tsconfig there.
      cwd: app(p.root),
      args: ["--config", join(app(p.root), "fsdev.config.ts")],
      logTo: join(scratch, "server.log"),
      env: {
        STORE_TYPE: "memory",
        FSD_ENV: "dev",
        FSD_DB_URL: "",
        DATABASE_URL: "",
        KITCHEN_SINK_TEST_MODE: "",
        // Each harness session's worktree goes under here, never the developer's state folder.
        XDG_STATE_HOME: join(scratch, "state"),
        KITCHEN_SINK_HARNESS_WORKSPACE: repo,
        // The repository's checks are the host's setting, like a project's in the other apps: a fixture, not a switch.
        KITCHEN_SINK_HARNESS_CHECKS: d.coder.check,
      },
    });
    const fsd = clientFor(served.origin, USER);
    const desk = (line: string) => askWorker(fsd, { user: USER, worker: DESK, line });
    return {
      stop: served.stop,
      asks: {
        date: (d) => desk(d.lines.date),
        sizing: (d) => desk(d.lines.sizing),
        skill: async (d) => {
          const turn = await desk(d.lines.skill);
          // Held by every specialist the desk can route to, so by whichever answered.
          const held = await Promise.all(SPECIALISTS.map((name) => heldSkills(tree(p.root), `support.${name}`)));
          return { ...turn, held: held.reduce((all, one) => all.filter((s) => one.includes(s))) };
        },
        multiFile: (d) => askWorker(fsd, { user: USER, worker: FSD, line: d.lines.pages }),
        knowledge: (d) => askWorker(fsd, { user: USER, worker: FSD, line: d.lines.knowledgeDocs }),
        coder: async (d) => {
          const sessionId = await fsd
            .flow(CLAUDE_CODE_FLOW)
            .createSession()
            .then(
              (session) => session.id,
              (error: unknown) => {
                throw new Error(`setup: Kitchen Sink serves no ${CLAUDE_CODE_FLOW} here (Claude Code mode is off on this host, e.g. a root server or no sign-in): ${String(error)}`);
              },
            );
          const askedAt = new Date();
          const sent = await fsd.flow(CLAUDE_CODE_FLOW).send("turn", { prompt: d.lines.coder }, { sessionId });
          // Its tool approvals are answered as the person would (`untilQuiet`).
          await untilQuiet(fsd, USER, 30 * 60_000, undefined, askedAt.getTime());
          const requestId = sent.id;
          // A fresh session: every item in it is this turn's.
          const turn = turnOf(await itemsOf(fsd, sessionId), askedAt, new Date());
          return { ...turn, checks: await turnChecks(fsd, sessionId, requestId) };
        },
      },
    };
  },
};

await runClosure(driver);
