# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Advanced Note Composer is an Obsidian plugin that enhances the built-in Note Composer core plugin, adding richer merge, split, extract, and swap operations for notes (with frontmatter merge strategies, footnote/backlink fixing, heading-aware merging, and templating). It is built on `obsidian-dev-utils`.

## Commands

| Task              | Command                    |
|-------------------|----------------------------|
| TypeScript check  | `npm run build:compile`    |
| Build             | `npm run build`            |
| Dev (watch)       | `npm run dev`              |
| Lint              | `npm run lint`             |
| Lint (fix)        | `npm run lint:fix`         |
| Format            | `npm run format`           |
| Format (check)    | `npm run format:check`     |
| Spellcheck        | `npm run spellcheck`       |
| Markdown lint     | `npm run lint:md`          |
| Markdown lint fix | `npm run lint:md:fix`      |
| Unit tests        | `npm test`                 |
| Coverage          | `npm run test:coverage`    |
| Integration tests | `npm run test:integration` |
| Commit (wizard)   | `npm run commit`           |

## Architecture

- **Root config files** are thin re-exports — actual logic lives in `scripts/` (`eslint.config.mts` → `scripts/eslint-config.ts`, etc.).
- **`src/`** — plugin source:
  - `main.ts` — Obsidian entry point (default export of `Plugin`); imports the global SCSS.
  - `plugin.ts` — `Plugin` class (extends `obsidian-dev-utils` `PluginBase`); `onloadImpl` wires up settings, settings tab, all command handlers, the Prism component, and release notes.
  - `plugin-settings.ts` — `PluginSettings` class plus the `Action`, `FrontmatterMergeStrategy`, `FrontmatterTitleMode`, and `TextAfterExtractionMode` enums; wraps `PathSettings` for include/exclude path filtering.
  - `plugin-settings-component.ts` — `PluginSettingsComponent` (settings load/save, value validators, legacy-settings converters).
  - `plugin-settings-tab.ts` — `PluginSettingsTab` settings UI (built with `SettingEx`/`SettingGroupEx`).
  - `prism-component.ts` — registers a Prism language for highlighting `{{token:format}}` template tokens.
  - `release-notes-component.ts` — shows version release notes once on layout ready.
  - `swapper.ts` — `swap` logic for exchanging two files or two folders (with optional full folder-structure swap).
  - `headings.ts` — helpers to extract a heading from editor selection/line.
  - `markdown-heading-document.ts` — parses markdown into a heading tree and merges documents heading-by-heading.
  - `insert-mode.ts` — `InsertMode` enum (append/prepend).
  - `filename-validation.ts` — regexes for invalid filename characters / trailing dots-or-spaces.
  - `templater.ts` — type augmentation for the optional Templater plugin API.
  - `command-handlers/` — one class per command (merge file/folder, swap file/folder, extract before/after cursor/current selection/this heading, split-by-headings), each extending an `obsidian-dev-utils` command-handler base.
  - `composers/` — core merge/split engine: `ComposerBase` (frontmatter merge, footnote/backlink/link fixing, templating) with `MergeComposer` and `SplitComposer` subclasses.
  - `item-selectors/` — resolve a chosen suggestion into a concrete target file: `ItemSelectorBase`, `MergeItemSelector`, `SplitItemSelector`.
  - `modals/` — suggestion/confirmation UI: `SuggestModalBase`, the merge/split/swap file/folder modals, and `SuggestModalCommandBuilder`.
  - `styles/` — `main.scss` plus the SCSS module type declaration.
- **`main` field** points to `src/main.ts` (Obsidian plugin source entry; built artifact is `dist/build/main.js`, not published to npm).

## Known Issues

None.

## Session progress — issue #120 + UX (2026-06-28, partly unattended)

Branch `fix/issue-120-extract-split-corruption`. Plugin commits (all on a green gate —
492 tests, 100% coverage, compile/lint/format/spell):
- `fix:` re-open source + restore selections before split edits (the corruption fix).
- `feat:` lock source & target notes during merge/split (`lockEditorForPath`).
- `feat:` minimizable progress modal; then `feat:` all suggest/confirm modals minimizable
  (via `src/open-minimizable-modal.ts`).
- `feat:` mtime guard — capture source+target mtime at start, re-check before mutating, refuse
  on external change (`ComposerBase.captureFileMtimes` / `checkFilesUnchanged`).

dev-utils changes (sibling repo `../obsidian-dev-utils`, on `main`):
- DONE + committed by user/deployed: minimizable-modal SCSS (`src/styles/minimizable-modal.scss`),
  the `file-open` listener in `editor-lock.ts` (fixes the "locks all notes" leak).
- DONE + committed by me (`feab8bbc`, `ddedd2dd`), NOT yet published: **`editor.ts` lock was a
  no-op** — it created a fresh CodeMirror `Compartment` and `reconfigure`d it without ever adding
  the compartment to the editor config, so CM6 ignored it (the editor never actually locked).
  Fixed by `StateEffect.appendConfig`-ing the compartment on first use, and locking with
  `EditorState.readOnly` ONLY (dropped `EditorView.editable.of(false)`, which broke app hotkeys
  like Ctrl+P). **Verified live over CDP** (port 8315): `appendConfig` + `reconfigure(readOnly(true))`
  → `state.readOnly=true`, `contentEditable` unchanged → edits blocked, hotkeys/focus preserved;
  `reconfigure([])` unlocks. CDP also confirmed the CSS (#9) loads.

### Pending (needs user)
- **Publish the dev-utils lock fix.** ✅ DONE — published `obsidian-dev-utils@82.0.0-beta.2`
  (release commit `aa117c7d`, tag pushed, on npm under the `beta` tag) via
  `npm run version prerelease -- --no-checks --no-changelog-editing` (the `--no-changelog-editing`
  flag is what skips the blocking `code -w` changelog editor; `--no-checks` alone does not). The
  plugin now consumes it (`devDependencies.obsidian-dev-utils` = `82.0.0-beta.2`, off `file:`); the
  `dev` watcher rebuilt + redeployed, and the deployed bundle has the `appendConfig` lock mechanism
  with no `editable.of(false)` (CDP-confirmed). Lock + hotkeys live for testing.
  (bash note: the `--` is npm's arg separator and needs no quoting — quoting is only a PowerShell nuance.)
- **#12 lock indicator** — ✅ DONE in `82.0.0-beta.3`. Lock icon now shows in the tab header
  (`tabHeaderStatusContainerEl`), the status bar (while the note is active), and the existing
  view-action-bar icon — all without a `Plugin` ref. 100% unit-tested.
- **#13 minimized-modal "easy to forget"** — ✅ DONE in `82.0.0-beta.3`. The floating minimized bar
  gently pulses an accent ring (user chose "pulse").
- **#15 editor-lock → internal `ComponentEx`** — ✅ DONE in `82.0.0-beta.3`. Workspace event
  subscribe/unsubscribe now via an internal `ComponentEx` (subscribe on load, cleanup on unload).
- **#17 (DEFERRED, needs decisions)** — per-plugin `Locked by <names>` tooltip (mechanical, via
  `getPluginId` from `plugin-id.ts`); right-click → Unlock → confirm → abort the operation (requires
  making the composer ops cancelable via an `AbortController` — cross-cutting); and an "unlock active
  file" command (ownership unclear: shared dev-utils functionality, not one plugin's).

### Dev-env (revert before releasing the plugin)
`package.json` pins `obsidian-dev-utils` to the prerelease `82.0.0-beta.3` — bump to the stable
`^82.0.0` (or whatever the released stable is) before releasing the plugin. `tsconfig.json` dropped
the unused `"svelte"` from `types`. The earlier `file:`/`--install-links` local-link setup is no
longer in use (the plugin consumes the published prerelease).

## Session progress — unlock UX + extract cursor (2026-06-29, unattended)

Five bugs fixed across the plugin and dev-utils (`../obsidian-dev-utils`, on `main`). Both repos'
full gates green (plugin: 505 tests, 100% cov; dev-utils: 3578 tests, 100% cov; compile/lint/
format/spell clean). Failing-test-first per fix; real behavior CDP-verified where noted.

Plugin commits (branch `fix/issue-120-extract-split-corruption`):
- `d3cf3a3` **#4** `feat:` make the merge/split file modal cancelable by unlocking. Modal-phase
  locks now carry an `AbortController`; `openMinimizableModal(modal, abortController)` closes the
  modal on abort, so unlocking (indicator menu / new tab menu / "Unlock active note") while the
  suggestion/confirmation modal is open (incl. minimized) closes it and releases the lock. Also
  refactored modal-phase locking to `using` declarations. (Root cause: the modal-phase lock had no
  controller → unlock was a no-op.) Works against `82.0.0-beta.10` (uses existing APIs).
- `195500a` **#5 (the real fix)** `fix:` capture the source selection BEFORE the split modal to
  prevent file-switch corruption. Root cause: `SplitComposer.splitFile` captured the selected text +
  offsets from `editor` AFTER the modal closed, but `editor` is the leaf's instance — if the user
  navigated that leaf to another note during the (minimizable) modal, the same `editor` reflected
  THAT note, so the extraction used the wrong note's content. Fix: capture text+offsets in
  `prepareForSplitFile` synchronously before the modal, thread them into `SplitComposer` as ctor
  params, and re-open the source FIRST. **CDP-verified end-to-end**: with the leaf switched to B.md
  mid-modal (confirmed rebind: editor `getSelection()` empty, `getLine(0)` == B's content), the
  extraction still correctly moved A's heading — identical to the no-switch scenario.
- `a24e920` **#5 (secondary)** `fix:` reveal the cursor after re-opening the source note. Re-open
  leaves the editor scrolled to the top; reveal the cursor's line via ephemeral state
  (`SplitComposer.revealCursor`). CDP-verified scrollTop follows the cursor. NOTE: my FIRST diagnosis
  of #5 was wrong — I thought it was only this scroll issue; the user corrected it to the content
  corruption above. Lesson logged: validate the real behavior before trusting a hypothesis (R2 G10r).

dev-utils commits (on `main`, NOT yet published):
- `abc957bb` **#1+#3** `feat(editor-lock):` add "Unlock" to the note's tab/file context menu
  (workspace `file-menu` handler on the lock events component) + render each locking plugin name
  as a code block in the unlock confirmation (DocumentFragment via `appendCodeBlock`). Shared
  `addUnlockMenuItem` helper. **#1 and #3 CDP-verified live** (file-menu shows `Unlock`; unlock
  dialog shows `Advanced Note Composer` in a `<code>`).
- `cc0674d7` **#2** `fix(minimizable-modal):` float the minimized bar above the status bar
  (`bottom: calc(var(--size-4-4) + var(--size-4-8))`) so it stops covering the bottom-right
  unlock indicator.

### Pending (needs user)
- **Publish a new dev-utils prerelease** (bump from `82.0.0-beta.10`) carrying `abc957bb`+`cc0674d7`,
  then bump the plugin's `obsidian-dev-utils` dep to it and rebuild. Only then do #1/#2/#3 reach
  users — #1/#3 are dev-utils-internal (auto via the bundled dev-utils), and **#2's CSS is injected
  from the dev-utils esbuild-embedded `dist/styles.css` at plugin-build time**, so the bar-position
  fix is NOT live until the plugin is rebuilt against the new dev-utils. Publishing is outward-facing
  → left for user confirmation.
- **#4 full-UI manual check**: minimize a split/merge modal, unlock the note, confirm the modal
  closes and the note unlocks. (Unit-tested + lock/unlock plumbing CDP-verified; the minimize→unlock
  UI path itself was not driven end-to-end.)
- The decisions in the old "#17 DEFERRED" note above are now implemented (tab-menu Unlock = #1;
  cancelable-via-AbortController = #4; "Unlock active note" command already existed).

### Dev-env note (this session)
For CDP E2E I copied the locally-built dev-utils `dist/` into the plugin's
`node_modules/obsidian-dev-utils/dist/` and deployed a fresh `main.js`/`styles.css`/`manifest.json`
to the `Investigate` vault. `npm install` will overwrite the node_modules copy (harmless). The
dev-utils editor-lock **manager is a global singleton** on `globalThis.__obsidianDevUtils.editorLock`
that survives plugin reloads — when testing new editor-lock code live, `delete` that key (or restart
Obsidian) so the new code re-instantiates the manager.

**Gotcha — never fake `LIBRARY_VERSION` for a live test.** A plain `npm run build` of dev-utils leaves
the `$(LIBRARY_VERSION)`/`$(LIBRARY_STYLES)` placeholders unsubstituted (only the release/version
script substitutes them). To load such a build I substituted `LIBRARY_VERSION` to a FAKE higher
version (`82.0.0-beta.11`). dev-utils' `initPluginContext` injects its CSS only when
`LIBRARY_VERSION > lastLibraryVersion` (a value stored on `globalThis.__obsidianDevUtils`). The fake
higher version poisoned `lastLibraryVersion`, so afterwards the real lower-versioned clean build
(`beta.10`) compared `<=` and SKIPPED re-injecting the CSS → minimize button + all dev-utils styles
broke (the injected `<style id=obsidian-dev-utils-styles>` was the 17-char placeholder, then empty).
Fix in-session: `globalThis.__obsidianDevUtils.lastLibraryVersion = { value: '0.0.0' }`, remove the
stale style element, reload the plugin (or just restart Obsidian). Lesson: do NOT fake the version;
to live-test dev-utils changes, publish a real prerelease (which substitutes both placeholders) or
restart Obsidian after any version hack. The committed code + a clean install are unaffected.
