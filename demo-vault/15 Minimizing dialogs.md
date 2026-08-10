[Docs](https://github.com/mnaoumov/obsidian-advanced-note-composer#minimizing-dialogs)

# Minimizing dialogs

Every **confirmation** dialog this plugin opens - plus the `Extract ...` (split) picker and the
`Move marked selection here (advanced)...` / `Reorder headings` option dialogs - can be
**minimized** to a small floating bar, so you can peek at the notes involved without losing
your place.

The initial `Merge ...` and `Swap ...` pickers are deliberately left out: no target has been
chosen yet, so there is nothing to park.

## Try it

1. Run `Merge current file with another file...` and pick a target note.
2. On the **confirmation** dialog, either use the minimize control **or simply click the dimmed
   background** - a click outside parks the dialog instead of cancelling the operation.
3. Browse your notes; the operation stays paused in the floating bar.
4. Use the bar's buttons:
   - **Restore** - reopen the dialog where you left off.
   - **Cancel** - close the dialog. For an operation that locked its note (an extract, split,
     or merge), cancelling this way also **unlocks the note** and cancels the operation.

Clicking outside used to throw the whole pending operation away. It now minimizes, so a stray
click costs you nothing: only `Escape`, the dialog's own **Cancel**, or the bar's **Cancel**
actually cancel.

This is the quickest way to check something mid-operation, and the bar's **Cancel** is a
discoverable way to release a locked note without the Command Palette.
