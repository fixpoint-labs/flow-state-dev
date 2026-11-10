# attachments › a session keeps a list of its files

**Issue:** FIX-2634
**Outcome:** A flow that includes the attachments block gets, with no other wiring, a list of every file its session's turns sent: one entry per file with its reference, name, media type and turn, read by the app like any resource list, kept through a restart, holding no bytes, and deleted with the session. The same flow without the block still keeps and serves its files.
**Input:** `host.mts` is a local server on an on-disk SQLite store hosting one chat twice: `with-block` taps `recordAttachments` before its reply, `without-block` doesn't. Neither names the list. For each flow, Alice uploads two fresh PNGs (16 to 32 KB of random bytes after the signature) and a small PDF (32 KB of random bytes after the header) through the upload route, sends the PNGs in one turn and the PDF in the next. The server is crashed (SIGKILL to its process group) and started again on the same store. Held-out: the bytes are random each run, and the references are the server's.
**Signal:**
- **list**: after the restart, `with-block`'s `attachments` list, read through `@flow-state-dev/client`'s collection list, holds exactly 3 entries; each sent file's reference has one, keyed by its blob id, with its file name, media type and the id of the request that sent it.
- **size**: that list page, as it crosses the wire, is under 5 KB and holds no run of base64 characters over 1 KB.
- **without**: `without-block`'s session manifest names no `attachments` resource (while `with-block`'s names it), and its 3 files each read 200 through `GET /api/flows/blobs/:id`.
- **delete**: after `with-block`'s session is deleted through the client, its list holds no entry and each of its 3 files reads 404.
**Anti-game:** Real processes, a real SQLite file, a real crash, the public routes only. The list is read through the client's collection route, never the block's handle or the store. Each entry is matched by the reference the upload returned, not by count alone. The lists `list`, `without` and `delete` grade go through `tell.over`, so an empty read is CAN'T TELL, not PASS.
**Model:** n/a
**Run:** `pnpm tsx goals/attachments/session-file-list/run.mts`
**Controls:** On the same command:
- `GOAL_CONTROL=skip-record` patches the block to record none of the turn's files (it still runs and declares the list). It must FAIL `list` (0 entries after the restart) and nothing else.
- On `main` before this issue the host does not start: `recordAttachments` is not exported.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-10 | fix/FIX-2634-attachments-block | n/a | PASS | SIGKILL and restart on SQLite; `with-block` lists 3 entries, references, names, types and request ids equal to the sent ones (906 bytes, no base64 run); `without-block` names no list, reads 3 × 200; after the session delete 0 entries, reads 3 × 404 |
| 2026-11-10 | fix/FIX-2634-attachments-block, `skip-record` | n/a | FAIL (expected) | Only `list`: 0 entries after the restart, CAN'T TELL on the empty read |
