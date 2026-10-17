# Swap selections

Exchange two pieces of selected text in one step - within one note or across two notes. This is the text-level counterpart to [17 Swap file](<../05 Swap/17 Swap file.md>) (whole notes) and [18 Swap folder](<../05 Swap/18 Swap folder.md>) (whole folders).

## Try it (within one note)

1. Select the word **alpha** in the line below.
2. Run `Swap selections: Mark selection to swap`.
3. Select the word **omega** in the same line.
4. Run `Swap selections: Swap with marked selection`.
5. The two words trade places: `alpha ... omega` becomes `omega ... alpha`.

Swap alpha with omega right here.

The first button below does steps 1 and 2, the second steps 3 and 4, and the third puts the line back.

```code-button
---
caption: Mark alpha
---
await require('/demoSetup.ts').runCommand(app, { commandId: 'mark-selection-to-swap', notePath: '05 Swap/19 Swap selections.md', selection: 'alpha', within: 'Swap alpha with omega right here.' });
```

```code-button
---
caption: Swap omega with the marked alpha
---
await require('/demoSetup.ts').runCommand(app, { commandId: 'swap-with-marked-selection', notePath: '05 Swap/19 Swap selections.md', selection: 'omega', within: 'Swap alpha with omega right here.' });
```

```code-button
---
caption: Put alpha and omega back
---
await require('/demoSetup.ts').resetDemo(app, ['05 Swap/19 Swap selections.md']);
```

## Try it (across two notes)

1. Mark a selection in this note with `Swap selections: Mark selection to swap` — the line below, say.
2. Open another note, select some text there, and run `Swap selections: Swap with marked selection` — the line in [Another note](<../Materials/19 Swap selections/Another note.md>), say.
3. The two selections are exchanged between the notes.

This line starts out in the swap selections note.

The first button below does step 1, the second step 2, and the third puts both lines back.

```code-button
---
caption: Mark the line in this note
---
await require('/demoSetup.ts').runCommand(app, { commandId: 'mark-selection-to-swap', notePath: '05 Swap/19 Swap selections.md', selection: 'This line starts out in the swap selections note.' });
```

```code-button
---
caption: Swap it with the line in Another note
---
await require('/demoSetup.ts').runCommand(app, { commandId: 'swap-with-marked-selection', notePath: 'Materials/19 Swap selections/Another note.md', selection: 'This line starts out in another note.' });
```

```code-button
---
caption: Put both lines back
---
await require('/demoSetup.ts').resetDemo(app, ['05 Swap/19 Swap selections.md', 'Materials/19 Swap selections']);
```
