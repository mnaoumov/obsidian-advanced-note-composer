[Docs](https://github.com/mnaoumov/obsidian-advanced-note-composer)

# Merge folder contents into a single file

Concatenate **every note inside a folder** (recursively, in path order) into **one brand-new note**
named after the folder and placed right beside it. This is distinct from `Merge current folder with
another folder...`, which mirrors the folder structure into another folder - here everything collapses
into a single file.

## Try it

1. Open any note inside the `Merge into single file` folder - for example [[Intro]].
2. Run `Merge current folder contents into a single file...` (also on the folder's right-click menu).
3. Confirm the dialog.

The notes [[Intro]], [[Part 1]], and the nested [[Part 2]] are combined, in path order, into a new
`Merge into single file.md` note next to the folder. Each note is run through the same merge pipeline
as a single-file merge, so your **Merge template**, **frontmatter merge strategy**, footnote fixing,
and link/backlink updates all apply. The source notes are deleted once merged.

## Notes

- The whole batch runs in one reversible transaction: if you cancel (or an external change is detected),
  everything rolls back.
- Notes whose path is excluded/ignored in the plugin settings are skipped and reported - unless
  **Should always merge excluded items** is on.
- Want the combined note in a specific place or with a different name? Rename or move it afterwards.
