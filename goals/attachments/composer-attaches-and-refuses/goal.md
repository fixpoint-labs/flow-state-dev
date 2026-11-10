# attachments › it composer-attaches-and-refuses

**Issue:** FIX-2518 (epic FIX-2516)

**Outcome:** In a composer built from the registry, a person attaches images by paste and by the + picker, sees each one above the text before Send with a remove button, is told in plain words why each refused file was refused, and Send's request carries references to the uploaded files, never their bytes.

**Input:** fresh PNGs per run (random colour, a random noise row, random sizes), one of them 3000–4000 × 2000–2500 px; a 25 MB file named `.png`; a HEIC-named file. Held out: any sizes, colours or names pass a correct composer. The page (`pages/composer.tsx`) is an adopter's chat page over `prompt-input` installed with `fsdev ui add prompt-input message` into a fresh host (`goals/lib/registry-host.mts`), sending to the `send` action of `../survive-a-restart-by-reference/host.mts`, a local server on on-disk SQLite with the engine's default blob folder. A small proxy in `run.mts` serves the page and passes `/api` to the server, so they share an origin.

**Signal:** read in headless Chromium, off the page and the requests it makes.

- **thumbnails**: after a paste and a pick, both images are drawn (loaded `<img>` with the file's name) inside the composer before Send; three images pasted at once draw three.
- **downscale**: the wide image's stored bytes, read from the server's blob folder by the id its upload answered, are at most 1,568 px on the longest side.
- **keyboard**: Tab from the page's start reaches "Attach files" and "Remove <name>" for both files.
- **send-enabled**: Send is enabled with no text and two files.
- **references**: the action request Send makes holds exactly two `fsd-blob:` references and no base64 run of 1 KB or more.
- **refusals**: with ten images attached, picking an 11th, the 25 MB file and the HEIC shows "Only 10 images per message", "<huge> is over 20 MB" and "<photo>.heic isn't supported" in an `aria-live` region; ten images stay; neither refused file is uploaded.

**Anti-game:** nothing reads the hook's state or a story's props: both can look right while Send ships data URLs. The references are counted in the request body on the wire; the thumbnails are images the browser loaded; the downscale is the server's stored bytes.

**Model:** n/a (model-free; the action records its input).

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/attachments/composer-attaches-and-refuses/run.mts`. Where the shadcn registry can't be reached (the CLI fetches its primitives from it), add `GOAL_REGISTRY=copy`: the items are copied from the registry in place of the install, and the verdict starts `[registry copied, not installed]`.

**Controls:** `GOAL_CONTROL=main-registry` puts the host's `prompt-input` and `message` back as on `main` before this change (8e82e8ced). Must fail **references** (data URLs, base64 in the request) and **thumbnails** (nothing drawn). It also fails downscale and keyboard, and leg c throws: `main`'s picker is not multi-select.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-10 | 7629e123e (its tree, before commit) | n/a | PASS | `GOAL_REGISTRY=copy` (ui.shadcn.com refused by this machine's proxy). Two thumbnails before Send; send held 2 references, no base64 run; wide image stored within 1568 px; three refusals in the live region; Tab reached + and both removes |
| 2026-11-10 | (same tree) | n/a | FAIL (expected) | `main-registry`, `GOAL_REGISTRY=copy`: thumbnails red (none drawn), references red (0 references, a 50,500-character base64 run), downscale and keyboard red, leg c threw on the single-file picker |
