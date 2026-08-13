[Docs](https://github.com/mnaoumov/obsidian-advanced-note-composer#move-selection-to-another-note-smart-cut--paste)

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
