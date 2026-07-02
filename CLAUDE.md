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

**BUILD-AHEAD status.** The dev-utils API this plugin consumes is **not published yet** (installed
dev-utils is 83.3.0; `VaultTransaction` is implemented-but-uncommitted, the `ResourceLock*` facade is
unwritten, and phase 4 is a breaking `EditorLockComponent`→`ResourceLockComponent` rename with no
shim). So the plugin code here is written against the **planned** API and **will not compile until
dev-utils lands phases 1–4 and the dep is bumped**. Do not expect `build:compile`/tests to pass until
then. Test files are intentionally NOT updated yet (per red→implement→confirm-real→cover: coverage
comes after the API is runnable and real behavior is confirmed via CDP).

### Assumed dev-utils API surface (align dev-utils to this, or update here if it drifts)

- `obsidian-dev-utils/obsidian/vault-transaction` — `VaultTransaction` (already implemented). Constructor
  gains `ownerSession?` in phase 4: `new VaultTransaction({ app, ownerSession?, stagingFolderPath? })`.
  Methods: `rename`/`create`/`createFolder`/`modify`/`process`/`trash` + `commit`/`rollback`/`[Symbol.asyncDispose]`.
- `obsidian-dev-utils/obsidian/resource-lock` — `ResourceLockComponent` (evolved `EditorLockComponent`):
  `lockResource(pathOrFile, { abortController?, mode?: 'file' | 'subtree' }): Disposable`, `unlockResource`,
  `isResourceLocked`, `isResourceLockedByAncestor`, `requestUnlock`,
  `createOwnerSession(abortController): ResourceLockOwnerSession` (`.armExpectedMutation({ kind, ... })`).
  Free wrappers renamed `isResourceLockedForPath` / `requestResourceUnlockForPath`.
- `PluginBase.resourceLockComponent: ResourceLockComponent` (renamed from `editorLockComponent`).

**Required `VaultTransaction` additions surfaced while wiring Phase 5 (feed back to dev-utils):**
1. `VaultTransaction` constructor must accept `ownerSession?` (already in plan phase 4).
2. `process(pathOrFile, newContentProvider)` must accept an **async / `ValueProvider`** content provider
   — the heading-merge builder (`parseMarkdownHeadingDocument`) is async; Phase 1 typed it sync-only.
3. New `captureRestorePoint(pathOrFile): Promise<void>` — snapshot the file's current content and push a
   restore-to-that-content inverse **without performing a mutation now**. Needed to make an **editor-driven**
   change reversible (split's destructive `editor.replaceSelection` is not a vault op the tx can capture).
   Behavior of restoring a file underneath an open editor buffer needs CDP confirmation (R2 G10r) before
   the split coverage is trusted.

### Phases

5. **`ComposerBase.runLockedTransaction` + injected-tx; migrate merge-file & split-file.** ✅ source done
   (build-ahead, red until dev-utils lands). `composer-base.ts`: added `runLockedTransaction`
   (lock every target with `this.abortController` → owner session → `VaultTransaction` → `body` →
   commit/rollback/release), `LockTarget`/`RunLockedTransactionParams`, injected-tx short-circuit,
   renamed the field `editorLockComponent`→`resourceLockComponent`, removed `lockNotes`/`unlockNotes`,
   threaded the tx through `insertIntoTargetFile`/`insertIntoTargetFileImpl` (writes via `tx.process`;
   added `insertContent` to replicate `FileManager.insertIntoFile` positioning so the write is
   tx-owned/reversible). `merge-composer.ts` + `split-composer.ts` now run inside `runLockedTransaction`
   (`tx.trash(sourceFile)` for merge; `tx.captureRestorePoint(sourceFile)` before split's editor edit).
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
