# Auto-number splits

A split can number what it creates, **continuing the numbering the destination already has** instead of starting over at `1`. Whether the number lands on the note or on the folder is decided by [11 Split into folder](<./11 Split into folder.md>): a note that gets a folder of its own has the number put on the **folder**, because the folder is what you see in the explorer.

Both are off by default. Each is a template, so the format is yours: the separator is ordinary text, `{{index:000}}` zero-pads, and `{{safeName}} ({{index}})` puts the number at the end. Leaving a template empty is how you switch that half off.

## The rule: one more than the highest, never a gap filled in

`{{index}}` is `1 + the highest number already in use` among the destination's siblings — not the number of siblings. A folder holding `1.`, `3.` and `4.` therefore continues at `5.`, and the missing `2.` stays missing. That matters because a deleted item in the middle can never make a new one collide with something that already exists.

Only siblings of the **same kind** count. Numbering a folder reads the folders beside it; numbering a note reads the notes. A `9. diagram.png` is never part of a note sequence, and an item numbered some other way — or not at all — is simply skipped.

## Numbering the note

```code-button
---
caption: Number the notes a split creates
---
await require('/demoSetup.ts').changeSettings(app, { numberedSplitNoteNameTemplate: '{{index}}. {{safeName}}', shouldSplitIntoFolder: false });
```

### Try it

Open [Flat source](<../Materials/40 Auto-number splits/Note example/Flat source.md>), which sits beside `1. A`, `3. B` and `4. C`.

1. Select the line below the horizontal rule.
2. Run `Extract current selection...` and type `D`.
3. Confirm.

The new note is `5. D`, not `D` and not `4. D`.

The name you typed is not lost. `D` differs from `5. D`, so it is recorded exactly as any other changed title is — as an alias and/or a `title` property, per **Should add invalid title to note alias** and **Frontmatter title mode** — which is what keeps `[[D]]` resolving. See [28 Invalid titles](<../09 Titles, links and frontmatter/28 Invalid titles.md>).

## Numbering the folder instead

```code-button
---
caption: Number the folders a split creates
---
await require('/demoSetup.ts').changeSettings(app, { numberedSplitFolderNameTemplate: '{{index}}. {{safeFolderName}}', numberedSplitNoteNameTemplate: '', shouldSplitIntoFolder: true });
```

With **Should split into folder** on, the same extract produces `5. D/D.md` — the folder carries the number and the note inside keeps the name you typed. Numbering both would write the number twice into one path, so the folder template wins whenever there is a folder.

## The whole hierarchy at once

`Split note by headings recursively...` always makes folders, whatever **Should split into folder** says, so the folder template is the one that applies to it.

### Try it

Open [Recursive source](<../Materials/40 Auto-number splits/Folder example/Recursive source.md>) — its folder already holds `1. A`, `3. B` and `4. C` — and run `Split note by headings recursively...`.

```text
1. A
3. B
4. C
5. D
  1. DD
  2. DD2
6. F
  1. FF
  2. FF2
```

`D` continues the folder's sequence at `5.`, and `F` then sees `5. D` and becomes `6.`. The children restart at `1.` inside each new folder for no special reason at all: `5. D/` has no numbered folders in it yet, so `1 + the highest` is `1`.

## Reading the number back in a template

Once the folder is numbered, the folder tokens of [11 Split into folder](<./11 Split into folder.md>) and [31 Templates](<../09 Titles, links and frontmatter/31 Templates.md>) carry that number. Setting **Split into folder note name** to `{{index}} {{safeFolderName}}` alongside the folder template gives `5. D/5 D.md` — the number is parsed back out of the folder through **Reordered folder name template**, the same one [23 Reorder folders](<../06 Folder operations/23 Reorder folders.md>) uses, so the two can never disagree about what a numbered name looks like.

## What is not numbered

- Splitting or extracting **into a note that already exists** — nothing is created, so there is nothing to number.
- `Create folder with notes...`, which has always had its own **Create folder name template** — see [22 Create folder with notes](<../06 Folder operations/22 Create folder with notes.md>).

`Create empty note at cursor...` and `Create empty note in folder...` **are** numbered, like every other note these settings create.

```code-button
---
caption: Turn auto-numbering back off
---
await require('/demoSetup.ts').changeSettings(app, { numberedSplitFolderNameTemplate: '', numberedSplitNoteNameTemplate: '', shouldSplitIntoFolder: false });
```
