#!/usr/bin/env bash
# A stand-in `codex` binary for the LAB-153 characterization POC.
#
# Records the argv, stdin and env the SDK hands it, then emits the JSONL that
# `codex exec --experimental-json` emits. FAKE_CODEX_MODE steers the ending:
#   ok (default) · hang · hang-grandchild · fail · crash · nousage · dead-resume
LOG="${FAKE_CODEX_LOG:-/dev/null}"
printf '%s\n' "ARGV: $*" >> "$LOG"
PROMPT="$(cat)"
printf '%s\n' "STDIN: $PROMPT" >> "$LOG"
printf '%s\n' "ENV CODEX_API_KEY=${CODEX_API_KEY:-<unset>} ORIGINATOR=${CODEX_INTERNAL_ORIGINATOR_OVERRIDE:-<unset>}" >> "$LOG"
TID="${FAKE_CODEX_THREAD_ID:-thr_fake_1}"
# `resume <id>` → the thread id is the one resumed, as the real CLI does.
for ((i=1; i<=$#; i++)); do
  if [[ "${!i}" == "resume" ]]; then j=$((i+1)); TID="${!j}"; fi
done
if [[ "${FAKE_CODEX_MODE:-ok}" == "dead-resume" ]]; then
  # LAB-153-thread-naming settlement: the real CLI, asked to resume an id it has
  # never seen, emits NOTHING on stdout (no thread.started, no event of any kind)
  # and fails on stderr with a plain-text RPC error — see real-cli-resume.mjs.
  # This mode reproduces exactly that, so it holds without hitting the network.
  echo "Error: thread/resume: thread/resume failed: no rollout found for thread id $TID (code -32600)" >&2
  exit 1
fi
echo "{\"type\":\"thread.started\",\"thread_id\":\"$TID\"}"
echo '{"type":"turn.started"}'
case "${FAKE_CODEX_MODE:-ok}" in
  hang)
    # Emit the thread id, then never finish — the abort test kills us. `exec` so
    # the sleeping process IS the child the SDK signals, as a native binary is.
    echo '{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"sleep","aggregated_output":"","status":"in_progress"}}'
    exec sleep 30
    ;;
  hang-grandchild)
    # Same, but the sleep is a GRANDCHILD holding our stdout open: bash defers
    # SIGTERM until its foreground child exits, so the pipe stays open.
    echo '{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"sleep","aggregated_output":"","status":"in_progress"}}'
    sleep 30
    ;;
  fail)
    echo '{"type":"turn.failed","error":{"message":"boom from the model"}}'
    ;;
  crash)
    echo '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"partial"}}'
    echo "fatal: something" >&2
    exit 3
    ;;
  nousage)
    echo '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"done, no usage"}}'
    ;;
  *)
    echo '{"type":"item.completed","item":{"id":"item_0","type":"reasoning","text":"thinking"}}'
    echo '{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"echo hi","aggregated_output":"","status":"in_progress"}}'
    echo '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"echo hi","aggregated_output":"hi\n","exit_code":0,"status":"completed"}}'
    echo '{"type":"item.completed","item":{"id":"item_2","type":"file_change","changes":[{"path":"notes.md","kind":"add"}],"status":"completed"}}'
    echo '{"type":"item.completed","item":{"id":"item_3","type":"agent_message","text":"Wrote notes.md"}}'
    echo '{"type":"turn.completed","usage":{"input_tokens":1200,"cached_input_tokens":200,"output_tokens":300,"reasoning_output_tokens":100}}'
    ;;
esac
exit 0
