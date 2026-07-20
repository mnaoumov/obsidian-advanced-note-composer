[Docs](https://github.com/mnaoumov/obsidian-advanced-note-composer#minimizing-dialogs)

# Minimizing dialogs

Every picker and confirmation dialog this plugin opens can be **minimized** to a small
floating bar, so you can peek at the notes involved without losing your place.

## Try it

1. Run any picker command - for example `Merge current file with another file...`.
2. Minimize the dialog using the minimize control.
3. Browse your notes; the operation stays paused in the floating bar.
4. Use the bar's buttons:
   - **Restore** - reopen the dialog where you left off.
   - **Cancel** - close the dialog. For an operation that locked its note (an extract, split,
     or merge), cancelling this way also **unlocks the note** and cancels the operation.

This is the quickest way to check something mid-operation, and the bar's **Cancel** is a
discoverable way to release a locked note without the Command Palette.
