# Merge folder

Merge **every note in a folder** into a single target note, in order.

## Try it

1. Open any note inside the `Merge folder` folder - for example [Chapter 1](<./Merge folder/Chapter 1.md>).
2. Run `Merge current folder with another folder...`.
3. Pick a target folder (or a new one) and confirm.

The chapters - [Chapter 1](<./Merge folder/Chapter 1.md>), [Chapter 2](<./Merge folder/Chapter 2.md>), and [Chapter 3](<./Merge folder/Chapter 3.md>) - are combined into
[Book](<./Merge folder/Book.md>). Watch the `chapter` tags collapse according to your frontmatter merge strategy,
and the footnote in Chapter 3 stay intact.

## Options

The confirmation step lets you include child folders and parent folders. Toggle
**Should include child folders when merging folders** and **Should include parent folders
when merging folders** in **Settings → Advanced Note Composer** to change the defaults.

## Land in the merged folder

Turn on **Should open the first note after merging folders** and the merge finishes by opening the first
note of the destination folder, so you end up where everything went instead of on a note that no longer
exists.

"First" is what the file explorer shows first: the destination folder's own notes, ordered naturally
(`5.` before `30.`), and only if it holds none, the first note of its first sub-folder. Notes that were
already in the destination count too - the point is where the folder starts, not which note the merge
happened to process first. A destination holding no note at all opens nothing.

Exactly one note is opened, once the whole merge has landed. The merged notes are never opened on the
way there, whatever **Should open note after merge** says - that would flicker the active tab through
every one of them.

```code-button
---
caption: Open the first note after merging folders, then reload
---
await require('/demoSetup.ts').changeSettingsAndReload(app, { shouldOpenFirstNoteAfterMergingFolder: true });
```

A markdown file that is really an attachment — an Excalidraw drawing stored as `sketch.excalidraw.md`,
per **Attachment extensions** — is moved into the destination like any other attachment rather than
merged into a note. See
[23 Merge folder into single file](<./23 Merge folder into single file.md>).

## Excluded items

By default, folder merge **skips** items whose path is excluded/ignored in the plugin settings and
reports them in a notice, so no stray empty target is left behind. Turn on **Should always merge
excluded items** to move and merge those items too (no "ignored" notice). Manual equivalent: toggle
**Should always merge excluded items** in **Settings → Advanced Note Composer**.

```code-button
---
caption: Always merge excluded items, then reload
---
await require('/demoSetup.ts').changeSettingsAndReload(app, { shouldAlwaysMergeExcludedItems: true });
```
