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
  - `move-selection-buffer.ts` — `MoveSelectionBuffer`, the transient holder for the "mark selection to move" feature (source note + captured selection + held source-note lock); shared by the mark/move/cancel command handlers.
  - `filename-validation.ts` — regexes for invalid filename characters / trailing dots-or-spaces.
  - `templater.ts` — type augmentation for the optional Templater plugin API.
  - `command-handlers/` — one class per command (merge file/folder, swap file/folder, extract before/after cursor/current selection/this heading, split-by-headings), each extending an `obsidian-dev-utils` command-handler base. The "smart cut & paste" feature adds `mark-selection-to-move`, `move-marked-selection-here`, and the top/bottom variants, plus `cancel-move` (a `GlobalCommandHandler`). The move-into-active-note commands share `MoveMarkedSelectionEditorCommandHandlerBase` (validation, mtime guard, buffer clear, `SplitComposer` handoff); subclasses only supply the insert point via `resolveInsertion()` and, optionally, override `resolveOptions()`. `MoveMarkedSelectionHereEditorCommandHandler` (cursor offset; registered twice via an `isAdvanced` flag for the default and advanced-options commands) keeps the paste-options modal; `MoveMarkedSelectionToEdgeEditorCommandHandler` (registered once per `InsertMode` → `move-marked-selection-to-top-of-file` / `move-marked-selection-to-bottom-of-file`, no default hotkeys) returns a `null` cursor offset so the composer derives top/bottom from `insertMode`. The move token is created by the shared `createMoveToken()` (`src/move-token.ts`).
  - `composers/` — core merge/split engine: `ComposerBase` (frontmatter merge, footnote/backlink/link fixing, templating) with `MergeComposer` and `SplitComposer` subclasses. The exported `resolveInsertOffset(content, insertMode)` maps an `InsertMode` to a concrete offset (Append = end of note, Prepend = just after frontmatter) and backs both `insertContent`'s append/prepend path and the move flow's top/bottom offset. `ComposerBase` also supports a move mode via an `insertToken` (content replaces the token at the insert point instead of appending/prepending); `SplitComposer.insertTokenIntoTargetFile` derives that offset from `insertMode` when `targetCursorOffset` is `null` (top/bottom), or uses the pinned cursor offset otherwise, and re-maps captured offsets for same-note moves. **Same-note split IS a move:** `SplitComposer`'s constructor synthesizes an `insertToken` when `sourceFile === targetFile` (so a same-note extract routes through the same-note-move ordering instead of the broken append/prepend path that would collapse the editor selection and turn the move into a copy), and forces `shouldFixFootnotes`/`shouldIncludeFrontmatter` off for same-note (footnote-fixing would rename+dangle the moved ref; re-including the note's own frontmatter is meaningless). The residual left in the source (link/embed/nothing) is resolved via `textAfterExtractionMode` (a `SplitComposer` param overriding the `Text after extraction` setting; defaults a same-note move to `None` unless the `shouldApplyTextAfterExtractionToSameFile` setting is on) in `replaceSourceSelection`. **Same-note move ordering:** for a same-note move (`isSameNoteMove`) the source selection is removed *before* the target write — the same-file write collapses the editor selection, so a post-write `replaceSelection` would be a no-op (turning the move into a copy); the write reads the post-removal buffer, so the removal survives, and footnote defs need no cleanup (refs + defs stay in the note). Cross-note/split keeps insert-then-remove so `fixFootnotes`/`updateEditorSelections` can extend the selection to also drop orphaned footnote definitions. **Data-loss guard:** `insertTokenIntoTargetFile` aborts (with a notice) when the derived/pinned insert offset falls strictly inside a captured selection (e.g. a same-note "top" move of a selection spanning the frontmatter boundary) — the token would otherwise be deleted with the source; the top/bottom command handlers also gate this in `canExecute` via `MoveSelectionBuffer.isOffsetInsideMarkedSelection`.
  - `item-selectors/` — resolve a chosen suggestion into a concrete target file: `ItemSelectorBase`, `MergeItemSelector`, `SplitItemSelector`.
  - `modals/` — suggestion/confirmation UI: `SuggestModalBase` and the merge/split/swap file/folder modals, plus `paste-options-modal.ts` (the advanced-move options modal + `MoveOptions`). The instruction-bar builder (`SuggestModalCommandBuilder`) now comes from `obsidian-dev-utils/obsidian/modals/suggest-modal-command-builder`. `SuggestModalBase` excludes the source note from its suggestions unless the `shouldAllowSameFile` flag is set; only `SplitFileModal` sets it (so `Extract …` can target the same note — `Enter` = bottom, `Shift+Enter` = top), keeping merge/swap from offering a file against itself. Modals are opened through `src/open-minimizable-modal.ts`, which exposes two helpers: `openMinimizableModal` (wraps the modal in dev-utils' `MinimizableModal`, adding a minimize button) is used by the 3 `ConfirmDialogModal` confirmations, where minimizing to inspect the two involved notes before confirming is the point; `openModal` opens plainly (no minimize button) and is used by the 5 initial picker modals (MergeFile/SplitFile/SwapFile/MergeFolder/SwapFolder), where a target is not chosen yet so minimizing serves no purpose and risks forgetting which note the operation started on (issue #125). The core `search-input-clear-button` (the "X" that clears the typed path) is Obsidian's own and is left untouched.
  - `styles/` — `main.scss` plus the SCSS module type declaration.
- **`main` field** points to `src/main.ts` (Obsidian plugin source entry; built artifact is `dist/build/main.js`, not published to npm).

## Resource locking & transactional rollback

Every merge/split/swap operation (files **and** folders) locks the resources it touches
(`ResourceLockComponent.lockForPath({ shouldBlockMutations: true })`) against edit/delete/rename/move,
detects external changes and aborts, and runs its vault mutations inside a reversible dev-utils
`VaultTransaction` that commits on success and rolls back on cancel/error. The shared runner is
`src/locked-transaction.ts` (`runLockedTransaction`), used by the composers and the swap/merge-folder
handlers; folder-merge threads one spanning transaction into each `MergeComposer`. Requires
`obsidian-dev-utils` ≥ 84.1.0 (`tx.rollback` uses `syncOpenEditorBuffersForPath` so split's rollback
survives an open editor). Unit tests use the real bridge (`App.createConfigured__()` + real
`ResourceLockComponent`/`VaultTransaction`), 100% coverage.

The former integration-only branches are now fully unit-covered against `obsidian-test-mocks` ≥ 3.5.1,
so their `/* v8 ignore */`s are gone: the nested / differently-named folder-swap paths in `swapper.ts`
(3.5.0 made folder rename cascade to descendants and `getAvailablePath` de-duplicate), and the
backlink-rewrite `linkConverter` in `merge-composer.ts` (`fixBacklinks`) — 3.5.0 gave synchronous link
indexing and 3.5.1 fixed the markdown parser's link end offset to the exclusive `start + length`, so
dev-utils' `editLinks` write path now completes against the mock.

## Known Issues

None.
