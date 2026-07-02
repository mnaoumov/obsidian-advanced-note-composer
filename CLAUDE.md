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
   `vaultTransaction.process(sourceFile, (c) => c)` before its destructive editor edit. **CDP-CONFIRMED
   INSUFFICIENT (2026-07-02):** restoring the source *file* content does NOT survive when the source is
   open in an editor — the editor's dirty buffer autosaves the extraction and clobbers the restore (both
   disk and editor end up extracted). So **split-rollback is BLOCKED** on a dev-utils fix: making the
   transaction's content restore **editor-aware** (reset the open `MarkdownView` buffer to the restored
   content, guarding against leaf navigation). Escalated to `obsidian-dev-utils` CLAUDE.md "Current Task"
   (per the cross-repo convention); merge/swap/merge-folder are unaffected (no editor edits). The current
   identity-process restore point stays in `split-composer.ts` as the intended hook — it becomes correct
   once dev-utils' restore is editor-aware.

### Phases

5. **`ComposerBase.runLockedTransaction` + injected-tx; migrate merge-file & split-file.** ✅ source done,
   compiles against 84.0.0. `composer-base.ts`: `runLockedTransaction` (lock every target with
   `lockForPath({ abortController, mode, shouldBlockMutations: true })` → build `VaultTransaction` with
   `openMutationBypass: () => bypassBlockedMutations(lockedPaths)` → run `body` → commit / rollback-on-throw
   → dispose lock disposables), `LockTarget`/`RunLockedTransactionParams`, injected-tx short-circuit,
   field `editorLockComponent`→`resourceLockComponent`, removed `lockNotes`/`unlockNotes`, threaded the tx
   through `insertIntoTargetFile`/`insertIntoTargetFileImpl` (plain insert via `tx.process` + `insertContent`
   replicating `FileManager.insertIntoFile` positioning; heading-merge computes async then `tx.modify`).
   `merge-composer.ts` uses `tx.trash(sourceFile)`; `split-composer.ts` records a restore point via identity
   `tx.process(sourceFile, c=>c)` before its editor edit. Also renamed `editorLock*`→`resourceLock*` across
   29 files (the whole cascade). **NOT done:** rewrite 3 composer test files (75 failing) against the real
   API + CDP-confirm real behavior; whether `fixBacklinks` edits to OTHER files route through the tx (open).
   **NOT yet done in this phase:** propagating the `resourceLockComponent` rename to the composer
   construction sites (command handlers / item-selectors) — deferred to phase 8; and deciding whether
   `fixBacklinks` edits to OTHER files route through the tx (open design point).
   Shared lifecycle: lock each target with `this.abortController`, open an owner session, build a
   `VaultTransaction`, run `body(tx)`, `commit` on success / `rollback` on abort or throw, release locks
   in `finally`. When a tx is **injected** (folder-merge), reuse it and skip lock/commit. Keep
   `captureFileMtimes`/`checkFilesUnchanged` as the pre-flight guard. Thread the tx through
   `insertIntoTargetFile` (target writes via `tx.process`/`tx.modify`; `processFrontMatter` stays as-is
   for now). Merge: `tx.trash(sourceFile)` replaces `trashSafe`. Split: the destructive
   `editor.replaceSelection` is an editor edit (not a vault op) → capture source content and register an
   inverse restoring it via `tx.process`. **Open design point:** faithful rollback of `fixBacklinks`
   edits to OTHER files (currently via `editLinks`→`process`) — decide whether to route through the tx.
6. **Swap file/folder** — tx-ify `swapper.ts` (`renameSafe`/`deleteIfNotUsed` → `tx.rename`/`tx.trash`);
   inject `resourceLockComponent` into `SwapFileCommandHandler`/`SwapFolderCommandHandler` (+ plugin.ts).
7. **Merge-folder single spanning transaction** — one `VaultTransaction` over the whole merge; inject it
   into each `MergeComposer`; route non-md `renameSafe` + emptied-subfolder `trashSafe` through it.
8. **plugin.ts wiring + the `editorLockComponent`→`resourceLockComponent` rename cascade** (29 files incl.
   14 tests — mechanical, do at dev-utils-bump time) + end-to-end integration tests.

## Known Issues

None.
