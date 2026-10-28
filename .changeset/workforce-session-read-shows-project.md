---
"@flow-state-dev/workforce": patch
---

A worker session's read now shows `workProjectId`, the project `setWorkProject` put the conversation in, so a screen can name it. It stays server-owned: a client still can't write it. (FIX-2278)
