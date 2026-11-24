# Facts for From the community (K-18, catalog)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example. No spec is cited, and neither is `docs/objectives.md` or `docs/architecture/`, which are not on that list. Paths are from the repo root.

Legend: **[page]** the page states it. **[ref]** belongs on a Reference page or on B-04; this page links, does not state it. **[gap]** nothing citable exists; the page must not assert it. **[reconcile]** a name that depends on a surface not yet settled; mark for cutover.

Abbreviations: `dk` = `packages/core/src/kit/define-kit.ts` · `ci` = `packages/core/src/index.ts` · `et` = `packages/engine/src/flowstate/types.ts` · `ek` = `packages/engine/src/flowstate/kits.ts` · `dkt` = `packages/core/test/define-kit.test.ts` · `kt` = `packages/engine/test/flowstate/kits.test.ts` · `cc` = `packages/claude-code/src/sdk/kit.ts` · `ccp` = `packages/claude-code/package.json` · `cat` = the Catalog page, `docs/contributing/docs-revamp/pages/catalog/index.md` · `kr` = `docs/contributing/docs-revamp/pages/reference/kits.md`.

## Flags against the page plan (read first)

1. **The shelf is empty, and nothing citable says how to be listed on it.** The plan's job line has two claims that no citable source supports: "it starts empty" and "how to get on it". No source, README, doc page, test or goal names a community shelf, a kit registry, a listing process, a naming convention for published kits (a scope, a prefix, a package keyword), a submission path, a search, or a command that lists or installs a kit. Checked by grep for `community` over `apps/docs/docs`, `apps/docs/guides`, `packages/*/README.md`, `packages/core/src` and `packages/engine/src`: the only hits are the unrelated "community search block" examples at `apps/docs/docs/fundamentals/blocks.md:757` and `apps/docs/docs/sequencers/connectors.md:144-148`. Checked by grep for `registry`, `marketplace`, `keywords` over `packages/*/package.json`: `keywords` is plain npm metadata, no kit convention (`packages/claude-code/package.json:5-14`). **[gap]** Question 2 ("How do you list one?") and Question 3 ("Is there a registry?") have no citable answer beyond the negative in fact 4. Escalate to the caller: the answer to "how do you get on the shelf" has to be an owner decision that lands in a citable surface (an approved spec's public names are allowed only for a surface not yet built, and the plan names none).
2. **"Starts empty" is true of the catalog, observable only as the absence of other kits.** The repository has exactly three kits that ship with the framework (fact 3.1). The page may say the shelf has no entries; it must not say how that came about or what is planned.
3. **The page-plan link target B-04 has no page yet.** `docs/contributing/docs-revamp/pages/build/` holds no kit-writing page, and no file under `docs/contributing/docs-revamp/pages/` names `B-04`. The caller supplies the slug (`../build/<slug>.md`); the sheet cannot. **[reconcile]**
4. **Stored data.** The page stores nothing, so the four questions (who owns it, who can see it, where it is stored, how many exist) have no stored part to ask about. There is no list, index or listing file behind the shelf. It is prose. The page must not imply a store.

## 1. What a community kit is, technically (Question 1)

A community kit is not a type. The surface has no "community" distinction: it is an ordinary kit that a package outside this repository exports. Every fact below is about kits in general.

- 1.1 A kit is "the installable unit above a flow". It "packages a feature so an app installs it with one config object": `createFlowState({ kits: [workforce({ model }), harnesses({})] })`. `dk:2-6`, `dk:204-206`. **[page]**
- 1.2 `defineKit` is exported from `@flow-state-dev/core`, with `slot`. `ci:111-112`. The kit types are exported beside it: `KitDefinition`, `KitFactory`, `KitInstance`, `KitFolder`, `KitInstallation`, `KitInstallInput`, `KitWithheld`, `AnyKitFactory`. `ci:113-125`. **[page]** (the import path only)
- 1.3 `defineKit` "returns its factory": the app "calls it with the kit's config and lists the result in `createFlowState({ kits })`, in any order." `dk:204-206`. So the thing a package exports is the factory, and the app calls it. **[page]**
- 1.4 A kit's definition holds: `name`, an optional `config` schema, `requires`, `slots`, `contributes`, an optional `directory`, and `install`, which returns the flows the kit serves. `dk:116-153` (fields), `dk:6-9` (summary). Only `name` and `install` are required (`dk:118`, `dk:149`; a kit with only those is built at `dkt:41`). **[ref]** (B-04 and the Kits reference carry the table; the page needs only "defineKit")
- 1.5 A kit "composes existing pieces: resources, views and capabilities ride on the flows the install returns." `dk:9-11`. **[page]** (one clause at most)
- 1.6 A kit's definition "is safe to import anywhere"; only its folder reader, which a kit's server entry supplies, touches the file system. `dk:13-15`. **[ref]**
- 1.7 The kit's `name` is "lowercase letters, digits and single hyphens, unique in an app". `dk:117`. At most 64 characters, and `_meta` is reserved (`packages/core/src/helpers/segment-name.ts:24-27`, `:21`). `defineKit` throws on a name that breaks the rule, and the name is "half of every slot key, joined with a `.`". `dk:219-226`, `dkt:24-27`. **[ref]** (a name rule belongs on B-04; the page may say a kit's name is unique in an app, fact 2.3)
- 1.8 Where a kit lives in a package: the three kits that ship with the framework are exported from a package like any other. `workforce` from `@flow-state-dev/workforce/kit`, `harnesses` from `@flow-state-dev/harness-manager/kit`, `claudeCode` from the root of `@flow-state-dev/claude-code` (`cat` kit rows; `cc:72-74`; `packages/claude-code/src/sdk/index.ts:80`). No rule says a kit has to be exported at a given path. **[ref]**

## 2. Installing one an app did not write

- 2.1 An app installs any kit the same way: "Kits to install, each a kit's factory called with its config, in any order: `kits: [harnesses({}), workforce({ model })]`." `et:160-163`, field at `et:170`. **[page]**
- 2.2 Installing a kit from another package is installing that package and listing its factory in `kits`. The existing Catalog page says exactly this: "A kit is the value `defineKit` returns, and any package can export one. An app installs it the same way as the three above: install the package, then list the kit in `kits`." `cat`, "From the community" section. **[page]**
- 2.3 A kit is listed once: `kit "<name>" is listed twice; a kit installs once per app.` `ek:60`, `kt:299-303`. Two kits with one name collide for that reason, since the name is the identity. **[ref]** (page may say "a kit's name is unique in an app", fact 1.7)
- 2.4 A kit the app lists is checked at start-up, not at install of the package. The app refuses to start when a kit it lists requires a kit that is not listed: `kit "c" requires kit "b", which is not installed.` `ek:66`, `kt:289-296`. A required kit must itself be in `kits`. **[ref]** (Kits reference, R-11)
- 2.5 A kit that fills another kit's slot must require that kit; otherwise `kit "stranger" fills slot "b.order", but does not require kit "b"`. `kt:249-259`. So a community kit that adds to the workforce or harnesses kits lists that kit in `requires`. The shipped example: `claudeCode` has `requires: [harnesses]` and the doc comment `createFlowState({ kits: [workforce({ … }), harnesses({ workspace }), claudeCode()] })`. `cc:67-74`. **[page]** (one sentence, as the reason a reader would want a kit: it adds to another)
- 2.6 A kit that fills a slot another kit declared puts the entry under the key `<kit>.<slot>`, read from the owning kit's factory (`harnesses.slots.harnesses`), never spelled. `dk:51-53`, `dk:196`, `dkt:14-22`. **[ref]**
- 2.7 A kit that depends on another ships that dependency as a package dependency: `@flow-state-dev/claude-code` lists `@flow-state-dev/core`, `@flow-state-dev/harness-manager`, `@flow-state-dev/workforce` and `@flow-state-dev/workspace` under `dependencies`, and its own agent SDK as an optional peer dependency. `ccp:50-62`. **[ref]** (the shipped example; B-04 decides what to say)

## 3. What is on the shelf today (Question 1 context, and the "starts empty" fact)

- 3.1 The kits that ship with the framework are three: `workforce` (`packages/workforce/src/kit/workforce-kit.ts:177`), `harnesses` (`packages/harness-manager/src/kit/harnesses-kit.ts`), `claudeCode` (`cc:72`). They are the only non-test `defineKit` callers in `packages`, `examples`, `labs`, `apps` and `goals`, besides the goal fixture `goals/kits/install-in-any-order/fixture/kits.mts`, which is test scaffolding. Grep: `defineKit(` over those folders, excluding `node_modules` and test files. **[page]** (as "the three kits above are the ones that ship with Flow State"; do not say there are no others anywhere, only that none are listed here)
- 3.2 Codex and Cursor are not kits. "Codex and Cursor are plain harness values, since they install nothing." `cc:4`. The page does not put them on this shelf. **[page]** (only if the page names what is not on it; otherwise omit)
- 3.3 The Catalog page ends the kit shelf with the three-row table and then this section. A reader reaches "From the community" by looking for kits beyond those. `cat`. **[page]**

## 4. What the page must say about a registry (Question 3)

All statements here are negative, and each is checked.

- 4.1 There is no command to list, search or install a kit. `grep -rni kit packages/fsdev/src/commands` returns nothing, and `packages/fsdev/README.md` documents no such command. **[page]**: "`fsdev` has no kit command."
- 4.2 There is no package-name rule for a kit, and nothing reads a package's metadata to find kits. The engine takes kit instances only from `createFlowState({ kits })` (`et:170`), a list the app writes. A kit does not register itself by being installed. **[page]** ("An app uses a kit when it lists it in `kits`. Installing a package does not add anything.")
- 4.3 So "Is there a registry?" is answered, citably, only as: the framework keeps no list of kits; a package manager's own registry is where a published package lives (`publishConfig.access: "public"` on a shipped kit's package, `ccp:37-40`). **[page]** (the first half; the second half is how npm works, not a Flow State fact, so leave it out)
- 4.4 Anything about a curated list, a submission process, review, versioning or compatibility policy for community kits: **[gap]**. Do not state any.

## 5. Questions the page answers, and what answers them

1. **What is a community kit, technically?** A kit like the three that ship, exported by a package outside this repository: the factory `defineKit` returns. Facts 1.1, 1.3, 2.2.
2. **How do you list one?** **Unanswerable from citable sources** (flag 1). The page may point at B-04 for writing a kit and say how an app installs one (fact 2.2). The step of getting on this page is a gap.
3. **Is there a registry?** The framework keeps none and an app only uses what it lists in `kits` (facts 4.1, 4.2). Whatever the shelf's future entries are, none is named here.

## 6. Limits to state flat

- The shelf has no entries. **[page]**
- An app uses only the kits in its own `kits` list; installing a package adds nothing by itself. `et:160-170`. **[page]**
- A community kit meets the same checks as a kit that ships: its name is unique in the app, its `requires` must be listed, and a fill needs a `requires` on the slot's owner (facts 2.3 to 2.5). The framework does not vet or version it. Only the last clause is **[gap]**-adjacent: no source says the framework does not vet kits, so state the first part and omit the "does not vet" clause. **[page]**
- Kit factories, config keys and slot names are not final, as for every kit page. **[reconcile]** at cutover. Print no config shape.

## 7. What the page will not state

- A registry, tag, label, list, website, repository or submission form for community kits.
- How to submit, who reviews, any naming convention, scope or keyword.
- That any community kit exists.
- Anything about the three shipped kits beyond their names (the Catalog page carries them).

## 8. Revision notes (round 1)

- `defineKit` returns a kit factory (`dk:211-218`, `KitFactory`); calling the factory with config returns the kit instance listed in `kits` (`dk:204-206`). The page says it in that order. Verified against the signature.
- The page's startup rules are now one sentence plus a link to the Kits reference section "What stops an app from starting", where each refusal and message already has a row (facts 2.3 to 2.5 live there).
- The use example imports `createFlowState` from `@flow-state-dev/engine` and `workforce` from `@flow-state-dev/workforce/kit` (`cat`, fact 1.8). `@acme/flow-state-board` and `board` are placeholders and the page says so. `board({})` prints no config shape.
- Round 2: the page now reads "`defineKit` from `@flow-state-dev/core` returns a function called a kit factory, and that factory is what the package exports" (facts 1.2, 1.3). It glosses a slot in one clause (fact 2.5, `dk:51-53`); the slot rule itself stays on the Kits reference. The `@acme/flow-state-board` import is a declared placeholder and stays unresolvable by design; with a stub of that module typed as a `defineKit` factory the example type-checks.
- Round 3: the startup-rules paragraph is now several short sentences (unique name; `requires` lists every dependency, slot owners included; a broken rule stops the app; link to the Kits reference section for each error and the definition shape). Facts 2.3 to 2.5 unchanged. The registry paragraph says "an installed package is never picked up on its own" (fact 4.2) and drops the repeated "ordinary package" sentence.
- "Flow State keeps no list of kits" now reads "Apart from this page, ..." so it does not contradict the shelf above it.
