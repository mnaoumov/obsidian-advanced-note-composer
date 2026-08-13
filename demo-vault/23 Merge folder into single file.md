# Merge folder contents into a single file

Concatenate **every note inside a folder** (recursively - a folder's own notes first, then each
sub-folder's) into **one brand-new note** named after the folder and placed right beside it. This is
distinct from `Merge current folder with another folder...`, which mirrors the folder structure into
another folder - here everything collapses into a single file.

## Try it

1. Open any note inside the `Merge into single file` folder - for example [Intro](<./Merge into single file/Intro.md>).
2. Run `Merge current folder contents into a single file...` (also on the folder's right-click menu).
3. Confirm the dialog.

The notes [Intro](<./Merge into single file/Intro.md>), [Part 1](<./Merge into single file/Part 1.md>), and the nested [Part 2](<./Merge into single file/Nested/Part 2.md>) are combined into a new
`Merge into single file.md` note next to the folder. Each note is run through the same merge pipeline
as a single-file merge, so your **Merge template**, **frontmatter merge strategy**, footnote fixing,
and link/backlink updates all apply. The source notes are deleted once merged.

## Numbered folders merge in index order

Notes and sub-folders are ordered by the numbers in their names, one numeric run at a time - so `5.`
comes before `30.`, and `1.2` before `1.10`. Text ordering would put both the other way round, since
it compares `3` against `5` and `1` against `2` character by character.

Run the merge on the `Merge index order` folder and read the result top to bottom:

1. [1. Overview](<./Merge index order/1. Overview.md>), [5. Middle](<./Merge index order/5. Middle.md>), [30. Appendix](<./Merge index order/30. Appendix.md>) - the folder's own notes, in index order.
2. Then the `1. Chapters` sub-folder: [1.1 First](<./Merge index order/1. Chapters/1.1 First.md>), [1.2 Second](<./Merge index order/1. Chapters/1.2 Second.md>), [1.10 Tenth](<./Merge index order/1. Chapters/1.10 Tenth.md>).

The rule is general, not an index-prefix parser: **every** run of digits in a name counts as one
number, wherever it sits. A name with no digits in it sorts alphabetically exactly as before.

## Send the merged note somewhere else

Where the merged note lands is decided by **Merge folder into file location** (below), but you can
override it for one merge: press `Change target` (or `Alt+C`) in the confirmation dialog and pick a
folder. The dialog re-renders with the new path, re-checking there for a name clash. Nothing is saved
to your settings - the next merge goes back to the configured location.

## Name the merged note

**Merge folder into file note name** (under `Merge` → `Merge folder` in the settings) names the merged note
instead of always using the folder name. Set it to `{{folderName}} summary` and the merge above lands
at `Merge into single file summary.md`. It takes `{{folderName}}`, `{{folderPath}}`, `{{parentFolder}}`,
`{{date:FORMAT}}` and `{{time:FORMAT}}`. Leave it empty to keep naming the note after the folder.

## Turn sub-folders into headings

Turn on **Should convert folders to headings when merging a folder** and run the merge again. The
nested `Nested` folder becomes a `# Nested` heading in the merged note, and [Part 2](<./Merge into single file/Nested/Part 2.md>)'s own headings
are demoted one level so they nest under it instead of competing with it. A folder one level deeper
would become `##`, and so on.

Every sub-folder is headed, including a completely empty one: the merged outline mirrors the whole
tree, so an empty folder is still part of it. Two note-less cases go the other way round — a folder
holding only attachments (with everything under it), and a folder whose notes exist but are all
excluded. Nothing of either was merged, so neither leaves a heading behind.

Markdown only defines six heading levels, so a folder more than six deep gets a `#######`-or-longer
line, which Obsidian renders as plain text rather than a heading. The full depth is still written out
— stopping at `######` would make a folder and its own descendants look like siblings.

This is the exact opposite of `Split note by headings recursively...` (see
[27 Split headings recursively](<./27 Split headings recursively.md>)): split a note into a folder
tree and merge it back, and the heading levels agree.

## See the merged note

Turn on **Should open the merged note after merging folder contents into a single file** and the merge
finishes by opening the note it produced, so you can read the result straight away.

It opens once, at the very end - after the note has taken its final name and the emptied folders are
gone. The merged notes are never opened on the way there, whatever **Should open note after merge**
says: that would flicker the active tab through every one of them.

```code-button
---
caption: Open the merged note, then reload
---
await require('/demoSetup.ts').changeSettingsAndReload(app, { shouldOpenNoteAfterMergingFolderIntoFile: true });
```

## Attachments

**Should move attachments when merging a folder** (on by default) carries the merged notes' attachments
into the merged note's attachment folder, so nothing is stranded in a folder that is about to
disappear. The destination comes from your vault's own attachment settings, so
[Custom Attachment Location](https://github.com/mnaoumov/obsidian-custom-attachment-location) is
honored when you have it installed. An attachment moves when one of the merged notes references it, or
when it already sits where that note's attachments belong. Turn the setting off to leave attachments
exactly where they are.

Markdown files that are really attachments are never merged - **Attachment extensions**
(default `.excalidraw.md`) lists them, written out in full with the leading dot, so an Excalidraw
drawing stored as `sketch.excalidraw.md` keeps its raw payload out of the merged note and is relocated
with the other attachments instead. The same applies to
[`Merge current folder with another folder...`](<./02 Merge folder.md>): a drawing is moved into the
destination folder like any other attachment — de-duplicated if one of the same name is already
there — rather than merged into it.

## Emptied folders

**Empty folders after merging a folder** decides what happens to the folders the merge empties:
`Delete` (the default) removes the merged folder and every emptied sub-folder, `Delete sub-folders
only` keeps the merged folder itself — even once it is empty — and removes every emptied folder under
it however deep, `Delete with empty parents` is `Delete` plus any parent the deletion leaves empty,
and `Keep` leaves everything in place. A folder still holding files is always kept.

Set it to `Delete sub-folders only` and run the merge above: `Merge into single file` survives as an
empty folder while its `Nested` sub-folder is gone. That is the setting for a folder whose own name
matters — it is where you keep filing things — but whose inner structure does not.

## Notes

- The command only appears where it has something to do: a folder holding fewer than two mergeable
  notes gets it in neither the right-click menu nor the command palette, since merging a lone note
  would only reproduce it under the folder's name. Attachments and sub-folders do not count towards
  the two - a folder holding one note plus a `sketch.excalidraw.md` is still a one-note folder, while
  a folder whose second note sits three levels down is not.
- The whole batch runs in one reversible transaction: if you cancel (or an external change is detected),
  everything rolls back. Folders are deleted only after it commits, so a cancelled merge never removes
  one.
- Notes whose path is excluded/ignored in the plugin settings are skipped and reported - unless
  **Should always merge excluded items** is on. Their attachments are left alone too.
