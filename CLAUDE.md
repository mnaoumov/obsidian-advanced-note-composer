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

## Current Task — Resource locking + transactional rollback (plugin half)

Wire the dev-utils locking/rollback primitives into every merge/split/swap operation (files **and**
folders) so each op locks the resources it touches against edit/delete/rename/move, detects external
changes and aborts, and fully rolls back on cancel/error. Full approved plan (both repos):
`~/.claude/plans/rustling-gliding-stearns.md`. The dev-utils half (phases 1–4) is being built in
parallel in `obsidian-dev-utils` (see that repo's CLAUDE.md "Current Task"); this repo owns plugin
phases 5–8.

**STATUS.** dev-utils **84.0.0** is published with the real API; the dep is bumped and **Phase 5 source
compiles**. My build-ahead assumptions differed from the shipped API in three ways — all reconciled (see
below). Remaining: rewrite the 3 composer test files (75 tests) against the real API + confirm real
locking/rollback behavior via CDP (R2 G10r) before finalizing coverage; then phases 6–8.

### Real dev-utils 84.0.0 API (as consumed here)

- `obsidian-dev-utils/obsidian/vault-transaction` — `new VaultTransaction({ app, openMutationBypass?, stagingFolderPath? })`.
  `openMutationBypass?: () => Disposable` opens the owner's mutation-bypass for the tx's own writes
  (typically `() => resourceLockComponent.bypassBlockedMutations(lockedPathsOrFiles)`); it is opened at
  construction and disposed when the tx settles. Methods: `create`/`createFolder`/`modify`/`process`
  (**sync** `(content: string) => string` provider)/`rename`/`trash` + `commit`/`rollback`/`[Symbol.asyncDispose]`.
- `obsidian-dev-utils/obsidian/resource-lock` — `ResourceLockComponent`:
  `lockForPath(pathOrFile, { abortController?, mode?: 'file'|'subtree', shouldBlockMutations? }): Disposable`,
  `unlockForPath`, `isLockedForPath`, `isLockedByAncestorForPath`, `isMutationBlockedByAncestorForPath`,
  `bypassBlockedMutations(pathsOrFiles): Disposable`. Free wrappers `lockResourceForPath` /
  `unlockResourceForPath` / `isResourceLockedForPath` / `requestResourceUnlockForPath`. `ResourceLockedError`.
  Owner-vs-intruder = `shouldBlockMutations: true` locks + an ambient `bypassBlockedMutations` scope (NOT
  an owner session / `armExpectedMutation`). `PathOrFile = string | TFile`, so lock a folder by its `.path`.
- `PluginBase.resourceLockComponent: ResourceLockComponent`. The `editor-lock` module is **removed**;
  `process`/`editLinks` now take `resourceLockComponent` (not `editorLockComponent`).

**Reconciliation of the three build-ahead assumptions:**
1. Owner session → **replaced** by `openMutationBypass` callback + `lockForPath({ shouldBlockMutations: true })`.
2. Async `process` → **not added**; instead the heading-merge computes the merged content async, then
   applies it via `vaultTransaction.modify(target, merged)` (captures old content for rollback like `process`).
3. `captureRestorePoint` → **not added**; split records a source restore point via an identity
   `vaultTransaction.process(sourceFile, (c) => c)` before its destructive editor edit. The
   open-editor-clobber gap this originally hit (CDP-confirmed 2026-07-02) is **RESOLVED in dev-utils
   84.1.0**: `tx.rollback` now calls `syncOpenEditorBuffersForPath` (public in
   `obsidian-dev-utils/obsidian/editor`) so it flushes/reloads the open `MarkdownView` buffer to the
   restored content. **No plugin code change needed** — split rolls back via `tx.rollback`, which now
   restores disk **and** editor (dev-utils' own `vault-transaction.obsidian.integration.test.ts` asserts
   exactly this). Split is UNBLOCKED; its rollback test is part of the phase-8 test rewrite.

### Phases

All SOURCE is done and compiles against 84.0.0 (committed: `chore: update obsidian-dev-utils to 84.0.0`
+ `feat: lock + transactional rollback for merge/split/swap/merge-folder`). The shared runner lives in
`src/locked-transaction.ts` (`runLockedTransaction` + `LockTarget`), used by the composers and the
swap/merge-folder handlers.

5. **merge-file & split-file** ✅ source. `composer-base.ts` threads the tx through `insertIntoTargetFile`
   (plain insert via `tx.process`+`insertContent` replicating `FileManager.insertIntoFile` positioning;
   heading-merge computes async then `tx.modify`). Merge uses `tx.trash(source)`. Split records a source
   restore point via identity `tx.process(source, c=>c)` before its editor edit — the open-editor gap is
   **resolved in dev-utils 84.1.0** (`tx.rollback` → `syncOpenEditorBuffersForPath`); no plugin change needed.
6. **swap file/folder** ✅ source. `swapper.ts` → `swap({ app, vaultTransaction, sourceFile, targetFile,
   shouldSwapEntireFolderStructure })`, all `renameSafe`/`createFolder`/`deleteIfNotUsed` routed through
   `tx.rename`/`tx.createFolder`/`tx.trash`. `SwapFile/FolderCommandHandler` gained `resourceLockComponent`
   and run `swap` inside `runLockedTransaction` (files `'file'`, folders `'subtree'` by path); `plugin.ts` wires it.
7. **merge-folder spanning transaction** ✅ source. `mergeFolder` wraps `mergeFolderImpl` in one
   `runLockedTransaction` (both folders `'subtree'`); `mergeFolderImpl` takes `(…, vaultTransaction,
   abortController)`, injects the tx into each `MergeComposer`, routes subfolder create / non-md rename /
   emptied-subfolder trash through the tx, and `throwIfAborted` at each loop head so an intruder abort rolls back.
8. **TESTS — the remaining unblocked work (currently red).** Rewrite against the REAL API per G49: use
   `App.createConfigured__()` (NOT a partial `strictProxy<App>`) + a real `new ResourceLockComponent(app,
   pluginId)` loaded as a child + a real `VaultTransaction` — the test-mocks vault adapter supports the tx
   staging ops (`mkdir`/`exists`/`trashSystem`/`trashLocal`/`rmdir`), confirmed by dev-utils'
   `src/obsidian/vault-transaction.test.ts` (the reference template; also `resource-lock.test.ts`).
   Files: `composer-base.test.ts` (currently a partial-mock `createDeps` — convert it), `merge-composer.test.ts`,
   `split-composer.test.ts` (all merge/split behavior EXCEPT the blocked rollback-under-editor assertion),
   `swapper.test.ts` + `swap-file/folder-command-handler.test.ts` (26 compile errors from the new `swap`
   signature), and verify `merge-folder-command-handler.test.ts`. Assert the observable EFFECT (files
   moved/merged/trashed, and on an induced abort the vault is restored) rather than mock-call spying.
   Then full gate (compile + `test:coverage` 100% + lint + format + spellcheck) + `npm run build`.

   **BLOCKER found while starting the merge test (2026-07-02) — resolve first.** The real-bridge setup
   works for the app/lock/tx (dev-utils' own tests prove it), BUT the composer needs its `sourceFile`/
   `targetFile` to be the SAME real vault file objects so `tx.trash(this.sourceFile)` / `tx.process(this.
   targetFile,…)` resolve to the real files. Two problems hit:
   - A `strictProxy<TFile>` file (as the OLD tests used) sets the composer fields fine, but tx methods
     that take the file OBJECT then operate on the proxy, not the real vault file — so nothing is really
     trashed/processed. (Passing `this.sourceFile.path` strings to the tx would dodge this but that's a
     source change motivated by tests.)
   - A REAL file from `app.vault.getFileByPath('x.md')` (after `createConfigured__({ files })`) assigned
     as the composer's `sourceFile`/`targetFile` comes back **`undefined` on the composer** (both fields),
     while a `strictProxy<TFile>` does not. Isolated repro: with `import { TFile } from 'obsidian'` (value)
     + `castTo<GenericObject>(app.metadataCache).computeMetadataAsync = vi.fn()` in `beforeEach`,
     `getFileByPath('x.md')` returns an object with `isTFile:false` and **no `.path`** — yet a BARE probe
     (no `TFile` value import, no `computeMetadataAsync` mutation) reads `.path` fine. So one of those two
     (the `TFile` value import bridging, or the metadataCache mutation) corrupts the vault's file objects.
     ROOT-CAUSE next: check the `obsidian-test-mocks` `createConfigured__`/`getFileByPath` contract and how
     `computeMetadataAsync` should be provided (maybe via `createConfigured__` options, not a post-hoc
     assignment); confirm files are created so `getFileByPath` returns real `TFile` instances usable both as
     composer fields AND by the tx. Only then is the real-bridge pattern viable across all 7 files.

## Known Issues

None.
