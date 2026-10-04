---
"@flow-state-dev/shift-manager": patch
---

Shift Manager is published. Install `@flow-state-dev/shift-manager` and run `shift-manager --config ./fsdev.config.mts` to open a Workforce Lab in the browser, with its pages prebuilt. `--dev` restarts the Lab when you save one of its files and reloads the open page. The command runs on `fsdev dev --app`, so the Lab's API, Shift Manager's pages and the DevTool are served as `fsdev dev` serves them. `--team`, `--devtool` and `--devtool-assets` are gone: pass a Lab's config with `--config` (FIX-1770).
