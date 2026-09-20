# Auto-number moves

`Move folder to...` and the three flatten commands can number what they **relocate**, continuing the numbering the destination already has. It is the same rule [40 Auto-number splits](<../03 Split/40 Auto-number splits.md>) applies to what a split **creates**, at the other four commands.

Both templates are off by default, and both are templates rather than toggles, so the format is yours: the separator is ordinary text, `{{index:000}}` zero-pads, and `{{safeFolderName}} ({{index}})` puts the number at the end. Leaving a template empty is how you switch that half off.

## The rule

`{{index}}` is `1 + the highest number already in use` in the **destination** - not the number of items there. A destination holding `1.` and `3.` therefore takes the arrival at `4.`, and the missing `2.` stays missing.

Folders and notes are two independent sequences, exactly as they are for a split: a folder reads the folders it is landing among, a note reads the notes. A non-markdown file is in neither sequence and is never renamed.

The number an item leaves behind in the folder it came from is simply left vacant. Closing that gap means renumbering notes you did not touch, which is what [23 Reorder folders](<./23 Reorder folders.md>) is for.

## Moving a folder

```code-button
---
caption: Number the folders a move relocates
---
await require('/demoSetup.ts').changeSettings(app, { numberedMovedFolderNameTemplate: '{{index}}. {{safeFolderName}}' });
```

### Try it

Open [Inside](<../Materials/41 Auto-number moves/Move example/Movable folder/Inside.md>), whose folder `Movable folder` carries no number.

1. Run `Move folder to...`.
2. Pick `Destination`, which already holds `1. Alpha` and `3. Gamma`.
3. The confirmation dialog now carries a **New name** row showing `4. Movable folder`, so the number is visible before anything happens.
4. Confirm.

The folder lands as `Destination/4. Movable folder`. The **New name** row appears only when the numbering actually changes the name, so a move with numbering off looks exactly as it always did.

## Flattening a folder

A flatten promotes several items at once, and the numbers **advance across the batch** rather than every item asking the destination the same question.

### Try it

Open [Loose note](<../Materials/41 Auto-number moves/Flatten example/Source folder/Loose note.md>) and run `Flatten folder...` on its `Source folder`.

```code-button
---
caption: Number the notes a flatten promotes too
---
await require('/demoSetup.ts').changeSettings(app, { numberedMovedFolderNameTemplate: '{{index}}. {{safeFolderName}}', numberedMovedNoteNameTemplate: '{{index}}. {{safeName}}' });
```

`Flatten example` holds folders numbered `1.` and `3.`, and notes numbered `2.` and `5.`. After the flatten:

```text
1. Existing
3. Another
4. Numbered child
2. First note.md
5. Second note.md
6. Loose note.md
```

The promoted folder continues the FOLDER sequence at `4.` and the promoted note continues the NOTE sequence at `6.` - the two never consult each other, which is why `6.` skips past a folder numbered `3.`.

The confirmation dialog previews all of it: its `old → new` arrows show the numbered names before a single item moves.

## An item that is already numbered is renumbered, not numbered twice

`3. Numbered child` above arrives as `4. Numbered child`, never as `4. 3. Numbered child`. The old number is read back out through the very template that writes the new one - the same parse [23 Reorder folders](<./23 Reorder folders.md>) uses - so the two can never disagree about what a numbered name looks like.

## Links follow a renamed note

Numbering a note changes its name, so every link to it is updated, exactly as when you rename it yourself. That is also why the note half is worth switching on deliberately: it renames notes, while the folder half only renames folders.

## What is not numbered here

- **Merges.** A merge consumes its source - nothing lands anywhere new.
- **Swaps.** A swap exchanges two items' places; renumbering both to the end of their new sequences would undo the thing the command does.
- **Renames.** `Rename folder...` keeps the folder where it is, and you typed the name. It has its own numbering rules - see [24 Rename folder](<./24 Rename folder.md>).
- **Splits, extracts and the two create-empty-note commands**, which are numbered by [40 Auto-number splits](<../03 Split/40 Auto-number splits.md>) instead.

```code-button
---
caption: Turn move numbering back off
---
await require('/demoSetup.ts').changeSettings(app, { numberedMovedFolderNameTemplate: '', numberedMovedNoteNameTemplate: '' });
```
