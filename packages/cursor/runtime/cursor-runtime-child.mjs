/**
 * The child process `@flow-state-dev/cursor` runs Cursor's local runtime in
 * when a `cursorAgent` block is given an `env`.
 *
 * Cursor's SDK has no environment option: every shell its local runtime starts
 * copies the process's own environment. So the only way to start the commands
 * Cursor runs with less than the server's environment is to give the runtime a
 * process whose environment is exactly the allowlist. That narrows what they
 * start with; it is not a security boundary (same OS user, so `/proc` still
 * shows the server's environment on Linux). The parent starts this script
 * with that environment and drives one agent and one run in it over the IPC
 * channel; `src/child-runtime.ts` is the other half and documents the protocol.
 *
 * Plain JavaScript on purpose: it runs under `node` as it ships, from `src/` in
 * the workspace and from `dist/` once published, with no build step between.
 *
 * argv[2] is the module to load the SDK from. The parent passes `@cursor/sdk`,
 * resolved from this file, which is where the version gate looked for it.
 */

const sdkModule = process.argv[2] || "@cursor/sdk";

/** @type {any} */
let Agent = null;
/** @type {any} */
let agent = null;
/** @type {any} */
let run = null;
/** The directory the agent was opened in: Cursor keys an agent's local store by it. */
/** @type {string | undefined} */
let cwd;

/** An error as plain data, so its class and code survive the channel. */
function serializeError(err) {
  if (err !== null && typeof err === "object") {
    return {
      name: typeof err.name === "string" ? err.name : "Error",
      message: typeof err.message === "string" ? err.message : String(err),
      code: typeof err.code === "string" ? err.code : undefined,
    };
  }
  return { name: "Error", message: String(err) };
}

/**
 * Post to the parent. A value the structured clone refuses (a function the
 * vendor left on a message) is sent as its JSON form instead of dropping it.
 */
function post(payload) {
  if (!process.connected) return;
  try {
    process.send(payload);
  } catch {
    process.send(JSON.parse(JSON.stringify(payload)));
  }
}

/** How long a close waits on a live run's cancel before it closes anyway. */
const CANCEL_ON_CLOSE_MS = 5_000;

/** Release the agent, then leave. Idempotent: disconnect and `close` can both get here. */
let closing = false;
async function closeAndExit() {
  if (closing) return;
  closing = true;
  // A run still going when the parent lets go (the parent died, or the server
  // restarted) is cancelled first. Left alone, Cursor's local store records it
  // as running after this process is gone, and refuses every later turn on
  // the agent for it.
  // Bounded: a wedged runtime's cancel may never settle, and this process
  // must still go.
  if (run !== null && run.status === "running") {
    let timer;
    await Promise.race([
      Promise.resolve()
        .then(() => run.cancel())
        .catch(() => {}),
      new Promise((resolve) => {
        timer = setTimeout(resolve, CANCEL_ON_CLOSE_MS);
      }),
    ]);
    clearTimeout(timer);
  }
  try {
    if (agent !== null && typeof agent[Symbol.asyncDispose] === "function") {
      await agent[Symbol.asyncDispose]();
    } else {
      agent?.close?.();
    }
  } catch {
    // Nothing to report to: the parent has already gone or asked us to go.
  }
  process.exit(0);
}

/** Forward the run's stream, in order, then say it ended. */
async function pump(current) {
  try {
    for await (const message of current.stream()) post({ event: "message", message });
    post({ event: "end" });
  } catch (err) {
    post({ event: "stream-error", error: serializeError(err) });
  }
}

/**
 * Cancel every run the agent's local store records as running, and say how
 * many. The same steps as `releaseActiveRuns` in `src/cursor-client.ts`.
 */
async function releaseActiveRuns() {
  if (typeof Agent?.listRuns !== "function" || typeof Agent?.cancelRun !== "function") return 0;
  const where = { runtime: "local", ...(cwd === undefined ? {} : { cwd }) };
  const running = [];
  let cursor;
  do {
    const page = await Agent.listRuns(agent.agentId, { ...where, ...(cursor === undefined ? {} : { cursor }) });
    for (const listed of page.items) if (listed.status === "running") running.push(listed.id);
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  for (const runId of running) await Agent.cancelRun(runId, where);
  return running.length;
}

async function handle(msg) {
  switch (msg.op) {
    case "open": {
      const sdk = await import(sdkModule);
      Agent = sdk.Agent;
      if (typeof Agent?.create !== "function" || typeof Agent?.resume !== "function") {
        throw Object.assign(new Error("`@cursor/sdk` was found but does not export an `Agent` with `create` and `resume`."), {
          code: "CURSOR_SDK_NO_AGENT",
        });
      }
      cwd = msg.options?.local?.cwd;
      agent = msg.agentId == null ? await Agent.create(msg.options) : await Agent.resume(msg.agentId, msg.options);
      return { agentId: agent.agentId };
    }
    case "release":
      return await releaseActiveRuns();
    case "send": {
      run = await agent.send(msg.prompt, msg.options);
      const supportsWait = typeof run.supports === "function" ? run.supports("wait") !== false : true;
      // Not `supports("steer")`: the SDK's probe knows no such operation and answers false.
      const supportsSteer = typeof run.steer === "function";
      // Started after the reply is queued, so the parent knows the run before
      // its first message arrives.
      queueMicrotask(() => void pump(run));
      return { runId: run.id, supportsWait, supportsSteer };
    }
    case "wait":
      return await run.wait();
    case "steer":
      return await run.steer(msg.text);
    case "cancel":
      await run?.cancel();
      return null;
    default:
      throw new Error(`unknown operation ${String(msg.op)}`);
  }
}

process.on("message", (msg) => {
  handle(msg).then(
    (value) => post({ id: msg.id, value }),
    (err) => post({ id: msg.id, error: serializeError(err) }),
  );
});

// The parent closing the channel is the signal to close: it does so when the
// block is done with the agent, and the channel also closes if the parent dies.
process.on("disconnect", () => void closeAndExit());
// A stop also sends this process's group SIGTERM, to reach the commands the
// agent started. Here it means the same close, not an exit that skips it.
process.on("SIGTERM", () => void closeAndExit());
