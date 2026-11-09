# attachments › it survives a restart by reference

**Issue:** FIX-824 (the FIX-2516 kill line)
**Outcome:** A file sent to a running local server comes back byte for byte after the server crashes and restarts. Only people who can read its session get it back. Every read of the session carries a reference to the file, never its bytes.
**Input:** `host.mts` is a local server on an on-disk SQLite store. It names no `blobs` slot, so files go where the engine's default puts them. It runs in a scratch working directory. Alice uploads ten fresh PNGs (64 to 128 KB of random bytes after the signature) and one PDF padded to exactly 20 MB through the upload route. Then she sends one message that names all eleven into a new session. The server is crashed (SIGKILL to its process group) and started again on the same store and folder. Held-out: the bytes are random each run, and nothing graded depends on file names or counts beyond the eleven sent.
**Signal:**
- **reads**: after the restart, each of the eleven ids, read through `GET /api/flows/blobs/:id` as Alice, answers 200 and hashes sha256-equal to the bytes uploaded.
- **session-read**: the session read plus its request list, as they cross the wire, is under 20 KB, holds all eleven references, and holds no run of base64 characters over 1 KB.
- **other-user**: Bob, signed in, reads each of the eleven ids and gets 404 every time.
- **repo**: no file changed under `packages/store-sqlite`, `packages/store-postgres`, or the engine's filesystem and memory store folders, and no package `dependencies` gained an entry (git diff from the merge base with `origin/main`).
**Anti-game:** Real processes, a real SQLite file and blob folder in a scratch directory, a real crash, and the public routes only. No call into the blob store. Hashes compare the uploaded bytes with the bytes read, not lengths or ids. The session read is measured as text on the wire, so a reference that only appears in a field the route does not send fails. The lists `reads`, `session-read` and `other-user` grade go through `tell.over`, so an empty list is CAN'T TELL, not PASS.
**Model:** n/a
**Run:** `pnpm tsx goals/attachments/survive-a-restart-by-reference/run.mts`
**Controls:** On the same command:
- `GOAL_CONTROL=memory-blobs` patches the default to put a durable profile's files in memory. It must FAIL `reads` (all eleven 404 after the restart) and nothing else.
- `GOAL_CONTROL=owner-blind` patches the route guard to stop comparing the caller with the session's owner. It must FAIL `other-user` (Bob gets 200) and nothing else.
- `session-read` and `repo` have no flag. Their blast radius was checked by hand: the message carried 30 000 random bytes as base64, and one line was appended to a `store-sqlite` source file. Only those two legs failed.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-09 | fix/FIX-824-blob-storage | n/a | PASS | 11/11 sha256-equal after SIGKILL and restart (10 PNGs, a 20 971 520-byte PDF); session read 3 467 bytes, 11 references, no base64 run; Bob 11 × 404; no adapter or dependency change |
| 2026-11-09 | fix/FIX-824-blob-storage, `memory-blobs` | n/a | FAIL (expected) | Only `reads`: all eleven ids answered 404 after the restart |
| 2026-11-09 | fix/FIX-824-blob-storage, `owner-blind` | n/a | FAIL (expected) | Only `other-user`: Bob's eleven reads answered 200 |
| 2026-11-09 | fix/FIX-824-blob-storage, by hand | n/a | FAIL (expected) | Blast radius: inline base64 in the message failed only `session-read` (43 468 bytes, 1 base64 run); a `store-sqlite` edit failed only `repo` |
| 2026-11-09 | fix/FIX-824-blob-storage (review fixes: per-send claims, owner index, hourly sweep, uploader check on read) | n/a | PASS | Same evidence as the first PASS: 11/11 sha256-equal, session read 3 467 bytes with 11 references, Bob 11 × 404. `memory-blobs` again FAILs only `reads`; `owner-blind` again FAILs only `other-user` |
