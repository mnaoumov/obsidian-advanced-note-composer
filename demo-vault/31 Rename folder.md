[Docs](https://github.com/mnaoumov/obsidian-advanced-note-composer)

# Rename folder

Rename a folder and keep its folder note in step — the note's own file name, its `title` property and its
`aliases` — all in one reversible operation.

A reorder changes a folder's **number**; a rename changes its **name**. Both write the folder note through
the same settings, so they can never disagree about what a folder note should say.

## Try it

1. Right-click the `1. Quarterly Report` folder inside `Rename example` and choose `Rename folder...`.
2. The prompt is seeded with `Quarterly Report` — the name **without** its number. The number belongs to
   the sequence, not to something you retype.
3. Type `Revenue Review` and click **Rename**.

The folder is now `1. Revenue Review`: it kept its place in the sequence. Open its `!` note and

- `title` is `1. Revenue Review` — the new name **with** the number;
- the first alias is now `Revenue Review`, swapped for the one the old name rendered;
- `the numbers note` is still there, untouched.

`2. Roadmap` is exactly as it was. A rename touches one folder.

## Aliases are swapped, not rewritten

**Folder note aliases template** (default `{{safeFolderName}}`) renders the alias the new name deserves.
Only the entry the **old** name rendered is replaced, and it is replaced where it stood — every alias you
wrote by hand survives. If the old entry is not there, the new alias is simply added.

Leave the template empty to leave `aliases` alone entirely. **Folder note title template** is the same
opt-out for `title`, and is shared with the reorder commands.

## The number is recognized, not assumed

`Reordered folder name template` is what reads the existing number back and writes it around your new
name, so a vault numbering its folders `007. Notes` or `Notes (7)` renames just as happily as one using
the plain `1. Notes`. A folder that never had a number simply takes the name you typed.

## What a plain rename does not do

Obsidian's own rename is untouched — only this command syncs the properties. This one also runs the whole
change inside a single resource-locked transaction: the folder, the note's name and both properties move
together, and cancelling rolls all of them back at once.
