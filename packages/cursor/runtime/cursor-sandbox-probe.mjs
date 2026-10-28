/**
 * Asks Cursor's SDK whether its local sandbox can start here, without
 * starting an agent or a run. `src/sandbox-probe.ts` is the other half.
 *
 * It must stay in this directory, beside `cursor-runtime-child.mjs`. The SDK
 * looks for its sandbox helper (`@cursor/sdk-<platform>-<arch>/bin/cursorsandbox`)
 * by walking up `node_modules` folders from the running script's directory, so
 * only a script beside the runtime's own gets the answer a run will get.
 *
 * The answer is the SDK's own: it prepares a local workspace for `cwd` with
 * the sandbox requested, the step a run takes before its first turn, and that
 * step fails with Cursor's error when the sandbox can't start. Preparing a
 * workspace makes no network call and starts no run; like a run, it leaves
 * Cursor's per-project store under `$HOME/.cursor`. The key is a placeholder:
 * the SDK prepares the sandbox only when given one, and it is never sent.
 *
 * argv[2] is the module to load the SDK from, argv[3] the workspace. Prints
 * one JSON line, `{ "supported": true }` or `{ "supported": false, "reason" }`.
 */

const [sdkModule = "@cursor/sdk", cwd = process.cwd()] = process.argv.slice(2);

let answer;
try {
  const sdk = await import(sdkModule);
  const platform = await sdk.createAgentPlatform({});
  const release = await platform.prewarmLocalWorkspace({
    apiKey: "sandbox-probe",
    local: { cwd, sandboxOptions: { enabled: true } },
  });
  await release();
  answer = { supported: true };
} catch (err) {
  answer = { supported: false, reason: err instanceof Error ? err.message : String(err) };
}
process.stdout.write(`${JSON.stringify(answer)}\n`);
process.exit(0);
