# Smart cut and paste

A decoupled, two-step **move**: mark a selection, then drop it exactly where you want -
even in the same note - as a single reversible operation.

## Try it

1. Select the paragraph under the rule below.
2. Run `Smart cut & paste: Mark selection to move`. The selection is highlighted and its
   note is locked so it cannot drift. A persistent notice appears.
3. Click into any note and position the cursor.
4. Run `Smart cut & paste: Move marked selection here` (or use the notice buttons: **Move
   at cursor**, **Move to top**, **Move to bottom**).

Changed your mind? Run `Smart cut & paste: Cancel move`, or click **Cancel move** in the
notice - the mark is discarded and the note unlocked.

## The commands

Each appears as `Smart cut & paste: ...` in the command palette.

- `Mark selection to move`
  - available with a selection. Records it and locks its note so the marked region cannot drift.
    Nothing is removed yet.
- `Mark heading to move`
  - available with the cursor inside a heading's section and nothing selected. Marks the whole
    heading — see below.
- `Move marked selection here`
  - moves the mark to the cursor, using your default settings. With text selected in the target, the
    moved text **replaces that selection**, like pasting over one.
- `Move marked selection here (advanced)...`
  - the same, but first prompts for the frontmatter merge strategy, whether to fix footnotes and
    include frontmatter, and the text to leave behind (see
    [07 Text after extraction](<../02 Extract/07 Text after extraction.md>)).
- `Move marked selection to top of file` / `... to bottom of file`
  - move the mark to just after any frontmatter, or to the end, regardless of the cursor.
- `Cancel move`
  - discards the mark and unlocks the note(s). The built-in `Unlock active note` command, and
    right-clicking a note's lock indicator, cancel the pending move the same way.

The move only removes the text from the source note when you run the paste, so footnotes, links and
frontmatter are still resolved from the intact source.

## Mark a whole heading

`Smart cut & paste: Mark heading to move` marks the heading your cursor is in - the heading line, its
body, and everything nested under it - so you never have to select a section by hand. Put the cursor
anywhere inside **Section to move** below (its body counts, not only the `#` line), run the command, and
every move above works on the whole section unchanged. With text selected the item leaves the right-click
menu, because that is what `Mark selection to move` is for.

While a *heading* is marked, the notice carries two extra buttons - **Split heading recursively...** and
**Reorder headings...** - so you can restructure the heading you just marked instead of moving it. Both
cancel the mark first: each rewrites the note the mark keeps locked. The block below hides them. Manual
equivalent: toggle **Should show split heading recursively button** and **Should show reorder headings
button** in **Settings → Advanced Note Composer**.

```code-button
---
caption: Hide the two heading buttons in the notice, then reload
---
await require('/demoSetup.ts').changeSettingsAndReload(app, { shouldShowReorderHeadingsButton: false, shouldShowSplitHeadingRecursivelyButton: false });
```

```code-button
---
caption: Show them again, then reload
---
await require('/demoSetup.ts').changeSettingsAndReload(app, { shouldShowReorderHeadingsButton: true, shouldShowSplitHeadingRecursivelyButton: true });
```

### Section to move

Put the cursor in this paragraph and mark the heading: this text and the sub-heading below travel with it.

#### Nested under it

Nested content moves too - the mark covers the whole subtree, exactly like `Extract this heading...`.

## Swap instead of move

The persistent notice also has a **Swap with selection** button. Instead of moving the marked
selection, it **swaps** it with the text you have selected in the active note: mark a selection,
then select some text in any note (or elsewhere in the same note) and click **Swap with
selection**. The two pieces of text trade places, both notes are locked during the swap, and it
runs as a single reversible operation. The button is enabled only while a single marked selection
and a non-overlapping active selection both exist.

---

Mark me, then move me somewhere else. While I am marked, my source note stays locked and I
stay highlighted so you always see what will move.

## Move to top / bottom hotkeys

`Move marked selection to top of file` and `... to bottom of file` ship with **no default
hotkey**. The block below binds `Alt+Shift+Up` to the "move to top" command. Manual equivalent: assign a hotkey in
**Settings → Hotkeys**.

```code-button
---
caption: Bind Alt+Shift+Up to "Move marked selection to top of file"
---
require('/demoSetup.ts').bindHotkey(app, 'advanced-note-composer:move-marked-selection-to-top-of-file', { modifiers: ['Alt', 'Shift'], key: 'ArrowUp' });
```

## Keep your place instead of following the moved text

By default the cursor **follows** the moved selection and selects it where it lands (see **A notice
instead of a highlight** below to change how that landing is shown) - handy when you moved the text in
order to keep working on it. When you move text to the top or bottom to get it *out
of the way*, you would rather stay put. The block below turns the jump off for both edge moves. Manual
equivalent: toggle **Should jump to content moved to top of file** and **... to bottom of file** in
**Settings → Advanced Note Composer**.

Try `Move marked selection to bottom of file` both ways: with the setting on, the moved paragraph ends
up selected at the bottom; with it off, the text still lands there but your cursor stays where you cut
it from. `Move marked selection here` is not configurable - it always jumps, since inserting at the
cursor and then leaving the cursor elsewhere would make no sense.

```code-button
---
caption: Stop the cursor following content moved to the top/bottom, then reload
---
await require('/demoSetup.ts').changeSettingsAndReload(app, { shouldJumpToMovedContentToBottom: false, shouldJumpToMovedContentToTop: false });
```

## A notice instead of a highlight

A selection in the target note looks exactly like the highlight on a selection that is still marked and
waiting to be moved, so "still marked" and "move finished" are hard to tell apart - most confusingly
while the notes are locked. **Smart cut & paste completion feedback** decides which one you get:
`Select moved content` (the default) selects the moved text, `Notice` puts the cursor on it *without*
selecting it and shows a notice instead, and `Select moved content and notice` does both. The cursor
travels either way. Manual equivalent: pick the mode in **Settings → Advanced Note Composer**.

Mark a paragraph, move it, and compare: with `Notice` the moved text is not highlighted at all, and a
notice tells you the move is done.

```code-button
---
caption: Report finished moves with a notice instead of a selection, then reload
---
await require('/demoSetup.ts').changeSettingsAndReload(app, { smartCutAndPasteCompletionFeedback: 'Notice' });
```

```code-button
---
caption: Go back to selecting the moved content, then reload
---
await require('/demoSetup.ts').changeSettingsAndReload(app, { smartCutAndPasteCompletionFeedback: 'SelectMovedContent' });
```

## A different template per direction

**Smart cut & paste template** is the template for a move *at the cursor*, and the default for the
top/bottom moves. Each edge move can override it, so "always leave a blank line after the frontmatter"
can apply to the top move alone. The block below sets a distinct template for each of the three
directions. Manual equivalent: paste the templates into **Smart cut & paste template**,
**Smart cut & paste template (to top of file)** and **... (to bottom of file)** in
**Settings → Advanced Note Composer**.

Mark a paragraph and run all three moves in turn: each one arrives with its own marker line.

```code-button
---
caption: Set a distinct template per move direction, then reload
---
await require('/demoSetup.ts').changeSettingsAndReload(app, { smartCutAndPasteTemplate: '\n\n> pasted at cursor\n\n{{content}}', smartCutAndPasteToBottomTemplate: '\n\n> pasted at the bottom\n\n{{content}}', smartCutAndPasteToTopTemplate: '\n\n> pasted at the top\n\n{{content}}\n' });
```

An empty template falls back up the chain, so an existing configuration keeps behaving as it did
before the per-direction settings existed:

```text
at cursor  ->  Smart cut & paste template                                              ->  Split -> Merge
to top     ->  Smart cut & paste template (to top of file)    -> Smart cut & paste template -> Split -> Merge
to bottom  ->  Smart cut & paste template (to bottom of file) -> Smart cut & paste template -> Split -> Merge
```

There is deliberately no separate template for `at cursor`: **Smart cut & paste template** *is* its
template, and simultaneously the fallback for the other two. All of them take the same tokens as the
other templates — see [31 Templates](<../09 Titles, links and frontmatter/31 Templates.md>).

Clear one override and that direction goes back to using **Smart cut & paste template**.

```code-button
---
caption: Clear the per-direction overrides, then reload
---
await require('/demoSetup.ts').changeSettingsAndReload(app, { smartCutAndPasteToBottomTemplate: '', smartCutAndPasteToTopTemplate: '' });
```

## Lock every note while marking

By default only the source note is locked. The block below locks **all** notes while a mark
is pending. Manual equivalent: toggle
**Should lock all notes when marking selection** in **Settings → Advanced Note Composer**.

```code-button
---
caption: Lock all notes while marking, then reload
---
await require('/demoSetup.ts').changeSettingsAndReload(app, { shouldLockAllNotesWhenMarkingSelection: true });
```

## Tailoring the notice

The persistent notice can be trimmed down, or turned off entirely. Hiding a button never unregisters
its command, so any hotkey you assigned to it keeps working.

- **Should show smart cut & paste notice**
  - turn the whole notice off and drive marking, moving and cancelling through the commands alone.
- **Should show move to top of file button** / **... to bottom of file button** / **... at cursor
  button**
  - hide any of the three move buttons you do not use. **Cancel move** is always shown.
- **Should show split heading recursively button** / **Should show reorder headings button**
  - the same for the two buttons a *heading* mark adds, both on by default.

## Switching between smart cut and split

Splitting and smart cut share the same setup, so you can change your mind in either direction without
starting over.

- The `Extract ...` picker carries a **Switch to smart cut & paste** button (or `Alt+S`)
  - the picker closes, your selection is marked to move, and the note highlighted in the picker opens
    so you can position the cursor and paste. The same button is on the split confirmation dialog,
    so you can switch after the target is chosen.
- The notice carries a **Switch to split/extract** button
  - also the `Smart cut & paste: Switch to split/extract` command. It re-opens the source note with
    the selection restored and opens the split/extract picker, so you can search for a target and
    split into it with the full option set.

## Moving within one note

The captured selection is **persistently highlighted in the source note**, so you always see exactly
what will move — both while a mark is held and while an `Extract ...` picker is open. The highlight
clears when the operation completes or is cancelled.

- `Move marked selection here` is unavailable while the cursor is inside the marked selection
  - and the top/bottom commands are unavailable when the top would land inside a selection that spans
    the note's frontmatter.
- **Text after extraction** is skipped for a same-note move
  - a link or embed pointing at the note itself is meaningless, so the moved text is simply removed.
    Enable **Apply text after extraction to the same file** to apply the setting anyway, or override
    it per move in the advanced command.
