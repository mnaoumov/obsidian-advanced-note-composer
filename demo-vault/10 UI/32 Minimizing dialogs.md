# Minimizing dialogs

Every **confirmation** dialog this plugin opens - plus the `Extract ...` (split) picker, the name box of [15 Name first, then the folder](<../03 Split/15 Name first, then the folder.md>), and the `Move marked selection here (advanced)...` / `Reorder headings` option dialogs - can be **minimized** to a small floating bar, so you can peek at the notes involved without losing your place.

The initial `Merge ...` and `Swap ...` pickers are deliberately left out, and so is the folder list that opens **before** that name box: no target has been chosen yet, so there is nothing to park.

## Try it

1. Open [Note to park](<../Materials/32 Minimizing dialogs/Note to park.md>), run `Merge current file with another file...` and pick [Parking destination](<../Materials/32 Minimizing dialogs/Parking destination.md>).
2. On the **confirmation** dialog, either use the minimize control **or simply click the dimmed background** - a click outside parks the dialog instead of cancelling the operation.
3. Browse your notes; the operation stays paused in the floating bar.
4. Use the bar's buttons:
   - **Restore**
     - reopen the dialog where you left off.
   - **Cancel**
     - close the dialog. For an operation that locked its note (an extract, split, or merge), cancelling this way also **unlocks the note** and cancels the operation.

The first button below does step 1 up to the pick: it opens **Note to park** and runs the command. The second puts both notes back if you went through with the merge.

```code-button
---
caption: Merge Note to park into another note
---
await require('/demoSetup.ts').runCommand(app, { commandId: 'merge-file', notePath: 'Materials/32 Minimizing dialogs/Note to park.md' });
```

```code-button
---
caption: Put Note to park back
---
await require('/demoSetup.ts').resetDemo(app, ['Materials/32 Minimizing dialogs']);
```

Clicking outside used to throw the whole pending operation away. It now minimizes, so a stray click costs you nothing: only `Escape`, the dialog's own **Cancel**, or the bar's **Cancel** actually cancel.

This is the quickest way to check something mid-operation, and the bar's **Cancel** is a discoverable way to release a locked note without the Command Palette.
