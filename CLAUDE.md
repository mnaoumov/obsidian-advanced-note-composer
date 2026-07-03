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

The nested / differently-named folder-swap paths in `swapper.ts` are now unit-covered against
`obsidian-test-mocks` ≥ 3.5.0 (its folder rename cascades to descendants and `getAvailablePath`
de-duplicates), so their former `/* v8 ignore */`s are gone.

**One remaining `/* v8 ignore */`d branch:** the backlink-rewrite `linkConverter` in
`merge-composer.ts` (`fixBacklinks`). test-mocks 3.5.0 fixed the read side (synchronous link
indexing), so the branch now executes, but its markdown parser still reports a link's
`position.end.offset` as `start + length - 1` (inclusive) instead of Obsidian's exclusive
`start + length`; dev-utils' `editLinks` write path slices one char short of the link, never matches,
and retries until timeout (recorded as a known bug in `obsidian-test-mocks` CLAUDE.md). Drop the
v8-ignore and cover it with a real backlink-rewrite unit test once test-mocks emits exclusive end
offsets (or cover it with a `*.desktop.integration.test.ts`).

## Known Issues

None.
