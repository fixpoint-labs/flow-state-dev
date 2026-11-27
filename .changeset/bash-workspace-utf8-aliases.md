---
"@flow-state-dev/tools": patch
---

Bash workspace folders and MOAT run names no longer collide for ids that differ only in lone UTF-16 surrogates (FIX-2939). Ids like `"\ud800"`, `"\udfff"` and `"�"` used to resolve to one folder, so a caller who controlled a user, org, tenant or session id could share another principal's files. Each now gets its own folder and container.

Ids that are valid Unicode, which is every ordinary id, keep the exact folder and run name they had, so existing workspaces stay where they are. The rare id with a lone surrogate gets a new, empty folder; its old folder was shared and is left untouched on disk.

Docs: none (no public API changes)
