# Swap file

Exchange the contents (and paths) of two notes in one step.

## Try it

1. Open [First note](<../Materials/17 Swap file/Swap examples/First note.md>) in the `Swap examples` folder.
2. Run `Swap file with...`.
3. Pick [Second note](<../Materials/17 Swap file/Swap examples/Second note.md>).
4. A confirmation dialog asks you to confirm the swap - click **Swap** (or **Change target** to pick a different note, or **Cancel** to abort).

The two notes trade places - a handy way to reorder notes whose names you want to keep.

The first button below does steps 1 and 2, so the picker of step 3 is waiting for you. The second puts both notes back where they started.

```code-button
---
caption: Swap First note with another note
---
await require('/demoSetup.ts').runCommand(app, { commandId: 'swap-file', notePath: 'Materials/17 Swap file/Swap examples/First note.md' });
```

```code-button
---
caption: Put both notes back
---
await require('/demoSetup.ts').resetDemo(app, ['Materials/17 Swap file']);
```

The confirmation dialog is controlled by the **Should ask before swapping** setting in **Settings → `Advanced Note Composer`** (on by default). Turn it off to swap immediately without confirming. Press **Don't ask again** in the dialog (or `Alt+D`) to turn it off from there.
