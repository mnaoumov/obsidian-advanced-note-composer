# Advanced Note Composer

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?logo=buy-me-a-coffee&logoColor=black)](https://www.buymeacoffee.com/mnaoumov)
[![GitHub release](https://img.shields.io/github/v/release/mnaoumov/obsidian-advanced-note-composer)](https://github.com/mnaoumov/obsidian-advanced-note-composer/releases)
[![GitHub downloads](https://img.shields.io/github/downloads/mnaoumov/obsidian-advanced-note-composer/total)](https://github.com/mnaoumov/obsidian-advanced-note-composer/releases)
[![Coverage: 100%](https://img.shields.io/badge/coverage-100%25-brightgreen)](https://github.com/mnaoumov/obsidian-advanced-note-composer)

This [Obsidian](https://obsidian.md/) plugin extends the core [`Note composer`](https://help.obsidian.md/plugins/note-composer) plugin fixing some bugs and adding additional features.

## Relative links

If you use `Merge current file with another file...`, `Extract current selection...`, `Extract this heading...` from the note with relative links, the core plugin moves those links as is, which leads to broken links you have to fix manually.

The current plugin adjusts such links and makes them valid.

## Invalid titles

Sometimes when you extract selection or heading, the chosen title is invalid

```md
# Title with invalid characters *\<>:|?#^[]"
```

The core plugin will show an error when you try to extract such heading.

The current plugin allows to replace/remove such invalid characters.

If those invalid characters were used intentionally, the plugin allows to add the invalid title

- to the note alias (to be able to access it from the `Quick switcher`).
- to the frontmatter title key.

## Treat title as path

`Treat title as path` option converts titles that contain `/` into paths.

For example, when we invoke `Extract this heading...` command for `## a / b / c / d`:

If `Treat title as path` option is

- **enabled** - the split file will be `a/b/c/d.md`. Leading and trailing spaces are trimmed.
- **disabled** - the split file will be `a _ b _ c _ d.md`. Spaces are preserved. `/` is replaced with `_` (or another replacement string as per settings).

## Move selection to another note (smart cut & paste)

The core `Extract current selection...` command moves a selection into another note in one step, always
appending/prepending it to that note. This plugin adds a decoupled, two-step **move** that lets you drop
the selection at an exact cursor position in any note (including the same note), while still running the
full extraction workflow (relative-link fixing, footnotes, frontmatter, templating).

Commands (each appears as **`Smart cut & paste: …`** in the command palette):

- **`Mark selection to move`** — available when there is a selection. Records the selection and its note,
  and locks that note (blocking edits) so the marked region cannot drift before you move it. The note stays
  unchanged — nothing is removed yet. Enable **Should lock all notes when marking selection** to lock *every*
  note (not just the source) while a mark is held, so you must finish the extraction before editing anything.
- **`Move marked selection here`** — available once something is marked. Moves the marked selection to the
  cursor in the current note, using your default settings, as a single reversible operation. If you have
  text selected in the target when you run it, the moved text **replaces that selection** (like pasting over
  a selection); with no selection, it is inserted at the cursor.
- **`Move marked selection here (advanced)...`** — same, but first prompts for the frontmatter merge
  strategy, whether to fix footnotes / include frontmatter, and the text to leave in place of the moved
  text (see **Text after extraction** below).
- **`Move marked selection to top of file`** / **`Move marked selection to bottom of file`** — available
  once something is marked. Move the marked selection to the top (just after any frontmatter) or bottom of
  the current note, regardless of the cursor position. These ship with **no default hotkeys** — bind your
  own in Obsidian's *Hotkeys* settings (for example `Shift+Enter` / `Enter`) for quick keyboard extraction.
- **`Cancel move`** — available once something is marked. Discards the mark and unlocks the note(s)
  without moving anything. The built-in `Unlock active note` command (available on any locked note), or
  right-clicking a note's lock indicator, cancels the whole pending move the same way.

While a selection is marked, a persistent **Smart cut & paste** notice reminds you that a move is pending
until you complete or cancel it. The notice carries buttons — **Move marked selection to top of file**,
**Move marked selection to bottom of file**, **Move marked selection at cursor**, and **Cancel move** —
each enabled only while it applies to the active note, so you can drive the whole move from the notice
without opening the command palette.

The **Smart cut & paste** settings group lets you tailor this notice:

- **Should show smart cut & paste notice** — turn the whole notice off if you prefer to drive marking,
  moving, and cancelling purely through the commands (and their hotkeys). Nothing is shown when a
  selection is marked.
- **Should show move to top of file button** / **Should show move to bottom of file button** /
  **Should show move at cursor button** — hide any of the three move buttons you do not use, leaving a
  tidier notice. **Cancel move** is always shown. Hiding a button never unregisters its command, so any
  hotkey you assigned to it keeps working.
- **Smart cut & paste template** — the template applied to the pasted text when you move a marked selection
  via smart cut & paste (`Move marked selection here`, `at cursor`, `to top of file`, or `to bottom of
  file`), so a smart-cut paste can be formatted differently from an ordinary split into a new note. Supports
  the same tokens as the other templates (`{{content}}`, `{{fromTitle}}`, `{{fromPath}}`, `{{newTitle}}`,
  `{{newPath}}`, `{{date:FORMAT}}`). Leave it empty to reuse the **Split template** (which itself falls back
  to the **Merge template**), preserving the previous behavior.

The captured selection is also **persistently highlighted in the source note** so you always see exactly
what will be moved. This applies both while a smart-cut selection is marked and while an `Extract …` /
split picker is open (the selection stays highlighted while you choose the target). The highlight clears
when the operation completes or is cancelled.

Notes:

- **Switch to smart cut from the split picker.** Because splitting and smart cut share the same setup, the
  `Extract …` picker shows a **Switch to smart cut & paste** button (or press `Alt+S`) that switches to smart
  cut & paste instead of splitting: the picker closes, your selection is marked to move, and the note
  highlighted in the picker opens so you can position the cursor and paste. The same **Switch to smart cut &
  paste** button also appears on the split confirmation dialog (when *Ask before splitting* is on), so you
  can switch after the target is chosen.

- **Change target from a confirmation dialog.** Every confirmation dialog that follows a target picker shows a
  **Change target** button (or press `Alt+C`) that sends you back to the picker to pick a different target —
  without cancelling and re-triggering the whole operation. This applies to the split confirmation dialog
  (when *Ask before splitting* is on) and to the merge-file and merge-folder confirmation dialogs (when *Ask
  before merging* is on). For the split and merge-file pickers, the reopened picker is preselected with your
  previous choice.

- The move only removes the text from the source note when you run the paste, so footnotes, links, and
  frontmatter are still resolved from the intact source.
- When the target is the same note as the source, `Move marked selection here` is unavailable while the
  cursor is inside the marked selection (and the top/bottom commands are unavailable when the top would
  land inside a selection that spans the note's frontmatter).
- **Same-note extraction from the picker.** The `Extract current selection...` / `Extract this heading...`
  pickers now also offer the *current* note as a target, so you can extract a selection to the top or
  bottom of the same note: press `Enter` (bottom) or `Shift+Enter` (top) on the current note in the picker.
- **Same-note moves and *Text after extraction*.** The **Text after extraction** setting decides what is
  left in place of the extracted text (a link to the target note, an embed, or nothing). When you move
  within the *same* note, a link/embed pointing at the note itself is meaningless, so by default the
  moved text is simply removed. Enable **Apply text after extraction to the same file** to apply the
  setting to same-note moves anyway, or override it per move in the advanced command.

## Installation

The plugin is available in [the official Community Plugins repository](https://obsidian.md/plugins?id=advanced-note-composer).

### Beta versions

To install the latest beta release of this plugin (regardless if it is available in [the official Community Plugins repository](https://obsidian.md/plugins) or not), follow these steps:

1. Ensure you have the [BRAT plugin](https://obsidian.md/plugins?id=obsidian42-brat) installed and enabled.
2. Click [Install via BRAT](https://intradeus.github.io/http-protocol-redirector?r=obsidian://brat?plugin=https://github.com/mnaoumov/obsidian-advanced-note-composer).
3. An Obsidian pop-up window should appear. In the window, click the `Add plugin` button once and wait a few seconds for the plugin to install.

## Debugging

By default, debug messages for this plugin are hidden.

To show them, run the following command:

```js
window.DEBUG.enable('advanced-note-composer');
```

For more details, refer to the [documentation](https://github.com/mnaoumov/obsidian-dev-utils/blob/main/docs/debugging.md).

## Support

<!-- markdownlint-disable MD033 -->

<a href="https://www.buymeacoffee.com/mnaoumov" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="60" width="217"></a>

<!-- markdownlint-enable MD033 -->

## My other Obsidian resources

[See my other Obsidian resources](https://github.com/mnaoumov/obsidian-resources).

## License

© [Michael Naumov](https://github.com/mnaoumov/)
