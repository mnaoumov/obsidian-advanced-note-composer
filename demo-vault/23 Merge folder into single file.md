[Docs](https://github.com/mnaoumov/obsidian-advanced-note-composer)

# Merge folder contents into a single file

Concatenate **every note inside a folder** (recursively - a folder's own notes first, then each
sub-folder's) into **one brand-new note** named after the folder and placed right beside it. This is
distinct from `Merge current folder with another folder...`, which mirrors the folder structure into
another folder - here everything collapses into a single file.

## Try it

1. Open any note inside the `Merge into single file` folder - for example [[Intro]].
2. Run `Merge current folder contents into a single file...` (also on the folder's right-click menu).
3. Confirm the dialog.

The notes [[Intro]], [[Part 1]], and the nested [[Part 2]] are combined into a new
`Merge into single file.md` note next to the folder. Each note is run through the same merge pipeline
as a single-file merge, so your **Merge template**, **frontmatter merge strategy**, footnote fixing,
and link/backlink updates all apply. The source notes are deleted once merged.

## Name the merged note

**Merge folder into file note name** (under `Merge folders` in the settings) names the merged note
instead of always using the folder name. Set it to `{{folderName}} summary` and the merge above lands
at `Merge into single file summary.md`. It takes `{{folderName}}`, `{{folderPath}}`, `{{parentFolder}}`,
`{{date:FORMAT}}` and `{{time:FORMAT}}`. Leave it empty to keep naming the note after the folder.

## Turn sub-folders into headings

Turn on **Should convert folders to headings when merging a folder** and run the merge again. The
nested `Nested` folder becomes a `# Nested` heading in the merged note, and [[Part 2]]'s own headings
are demoted one level so they nest under it instead of competing with it. A folder one level deeper
would become `##`, and so on.

This is the exact opposite of `Split note by headings recursively...` (see [[27 Split headings
recursively]]): split a note into a folder tree and merge it back, and the heading levels agree.

## Attachments

**Should move attachments when merging a folder** (on by default) carries the merged notes' attachments
into the merged note's attachment folder, so nothing is stranded in a folder that is about to
disappear. The destination comes from your vault's own attachment settings, so a custom attachment
location is honored.

Markdown files that are really attachments are never merged - **Markdown attachment sub-extensions**
(default `excalidraw`) lists them, so an Excalidraw drawing stored as `sketch.excalidraw.md` keeps its
raw payload out of the merged note.

## Emptied folders

**Empty folders after merging a folder** decides what happens to the folders the merge empties:
`Delete` (the default) removes the merged folder and every emptied sub-folder, `Delete with empty
parents` also removes any parent left empty, and `Keep` leaves everything in place. A folder still
holding files is always kept.

## Notes

- The whole batch runs in one reversible transaction: if you cancel (or an external change is detected),
  everything rolls back. Folders are deleted only after it commits, so a cancelled merge never removes
  one.
- Notes whose path is excluded/ignored in the plugin settings are skipped and reported - unless
  **Should always merge excluded items** is on. Their attachments are left alone too.
