# Rename folder

Rename a folder and keep its folder note in step — the note's own file name, its `title` property and its `aliases` — all in one reversible operation.

A reorder changes a folder's **number**; a rename changes its **name**. Both write the folder note through the same settings, so they can never disagree about what a folder note should say.

## Try it

1. Right-click the `1. Quarterly Report` folder inside `Rename example` and choose `Rename folder...`.
2. The prompt is seeded with `Quarterly Report` — the name **without** its number. The number belongs to the sequence, not to something you retype.
3. Type `Revenue Review` and click **Rename**.

The folder is now `1. Revenue Review`: it kept its place in the sequence. Open its `!` note and

- `title` is `1. Revenue Review` — the new name **with** the number;
- the first alias is now `Revenue Review`, swapped for the one the old name rendered;
- `the numbers note` is still there, untouched.

`2. Roadmap` is exactly as it was. A rename touches one folder.

## Aliases are swapped, not rewritten

**Folder note aliases template** (default `{{safeFolderName}}`) renders the alias the new name deserves. Only the entry the **old** name rendered is replaced, and it is replaced where it stood — every alias you wrote by hand survives. If the old entry is not there, the new alias is simply added.

Leave the template empty to leave `aliases` alone entirely. **Folder note title template** is the same opt-out for `title`, and is shared with the reorder commands.

## The number is recognized, not assumed

`Reordered folder name template` is what reads the existing number back and writes it around your new name, so a vault numbering its folders `007. Notes` or `Notes (7)` renames just as happily as one using the plain `1. Notes`. A folder that never had a number simply takes the name you typed.

The default alias template matches what [22 Create folder with notes](<../06 Folder operations/22 Create folder with notes.md>) already writes, so a folder created and then renamed ends up with the alias it would have had if you had created it under the new name.

## Which note is the folder note

Several commands need to know which note **describes** a folder — the one whose properties a reorder or a rename keeps in step, and the one a folder name in an [operation notice](<../10 UI/33 Operation notices.md>) opens when you click it. **Folder note location** (under `Folder note` in the settings) answers that:

- `Auto` (the default)
  - reads the installed [Folder notes](https://github.com/LostPaul/obsidian-folder-notes) plugin every time, so reconfiguring that plugin needs no change here. Without it, `Auto` means a note named after its folder, inside it (`alpha/bravo/charlie/charlie.md`).
- `Inside the folder` / `Beside the folder`
  - say it yourself. The second is the `alpha/bravo/charlie.md` layout, whose point is that a link to `alpha/bravo/charlie` reaches a folder with no special syntax.
- `This vault has no folder notes`
  - turns the whole idea off; no properties are ever rewritten.

**Folder note name template** names it when you have chosen a location yourself: `{{folderName}}` names it after its folder, while a literal like `!` or `index` gives every folder note the same name. That is why this vault's `Rename example` folders use `!`.

That plugin's third option — keeping every folder note in one central folder — has no equivalent here, and `Auto` falls back when it is set: with the notes pooled, which note belongs to a folder no longer follows from the folder's path.

When the folder note is named after its folder, renumbering or renaming the folder renames the note with it — otherwise `1. Alpha/1. Alpha.md` would become `3. Alpha/1. Alpha.md`, which by that very rule is no longer a folder note. A fixed name like `!` needs no rename and gets none.

## What a plain rename does not do

Obsidian's own rename is untouched — only this command syncs the properties. This one also runs the whole change inside a single resource-locked transaction: the folder, the note's name and both properties move together, and cancelling rolls all of them back at once. Links are updated by the underlying rename, as always.

The new name is refused if it would be empty or if it still contains invalid characters (with **Should replace invalid title characters** off), exactly as when creating a folder. If a sibling is already called that, the name is de-duplicated into `Beta 1` and the properties describe the folder that actually exists. A folder whose path is [ignored](<../08 Include and exclude/26 Block commands on excluded paths.md>) is refused with a notice, and the vault root is never offered — it has no name of its own to change.
