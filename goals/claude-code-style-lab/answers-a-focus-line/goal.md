# claude-code-style-lab › threads mode answers a focus line instead of filing it

**Issue:** FIX-2584

**Outcome:** In the Claude Code-style lab's Projects view, a person who tells the main session
what they'll be working on, and asks for nothing, gets a short reply and a session named for it.
No thread starts, so nothing lands under *Waiting on you*. A message that does ask for work
still starts a thread.

**Input:** `fixtures/input.json`: a project name, the focus line Jake sent on 2026-11-05 ("We are
going to focus on Claude Code Style UX improvements"), and one ask for work. It is
**held-out**: no worker file, prompt or flow names any of it.

**Signal:** one browser on `fsdev dev --config labs/claude-code-style/fsdev.config.mts --app
@flow-state-dev/claude-code-style`, with a fresh data folder and a fresh `file://` repository.

- **1** after the focus line's turn ends, the lead's board (`listTasks_tasks`) holds no task, the
  main thread shows no thread card, the board shows no row, and the line isn't marked
  *Sent to a task*.
- **2** a reply shows under the line, at most 600 characters.
- **3** the session has a title of its own (`sessions.get`), and its row in the sessions list
  shows it.
- **4** an ask for work, sent next, files a task for `desk.thread`.
- Throughout: the page throws nothing and the lab's checkout is untouched.

**Anti-game:** every signal reads the rendered page or the server's own records. Nothing asserts
on the adapter, the fake in `test/`, or React state. Both lines are typed in the browser.

**Retries:** none. Whether the lead files a focus line is the thing graded.

**Model:** real — `openai/gpt-5.4` (the lab's default), through the AI Gateway.

**Run:** `pnpm tsx goals/claude-code-style-lab/answers-a-focus-line/run.mts`

**Controls** (`GOAL_CONTROL=<name>`; each plants its change for the run and puts it back):
- `files-everything`: the lead's instructions go back to splitting every request into threads,
  with nothing on answering a message that asks for no work. Must FAIL signal 1.
- `no-title`: the threads-mode flow is built without the title generator. Must FAIL signal 3.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-06 | 40d5c857 (local, before the fix) | openai/gpt-5.4 | FAIL | Reproduces FIX-2584: signal 1, the focus line was filed to `desk.thread` and marked Sent to a task; signal 3, no title (threads mode ran no title generator) |
| 2026-11-06 | 40d5c857+fix (local) | openai/gpt-5.4 | FAIL | Signals 1–3 passed; signal 4, the lead wrote the cache comparison itself. The instructions now say any work, however small, is a thread's |
| 2026-11-06 | 40d5c857+fix (local) | openai/gpt-5.4 | PASS | Replied "Got it — I've taken in that the focus is…"; titled "Claude Code style UX improvements"; the ask filed "Short cache comparison" for `desk.thread` |
| 2026-11-06 | 40d5c857+fix (local) | openai/gpt-5.4 | FAIL (control `files-everything`) | Signal 1: the focus line filed to `desk.thread`, marked Sent to a task |
| 2026-11-06 | 40d5c857+fix (local) | openai/gpt-5.4 | FAIL (control `no-title`) | Signal 3: no title |
| 2026-11-06 | 40d5c857+fix (local) | openai/gpt-5.4 | PASS | Second green run: same reply and title; filed "Compare Node API cache options" for `desk.thread` |
