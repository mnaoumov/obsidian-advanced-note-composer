[Docs](https://github.com/mnaoumov/obsidian-advanced-note-composer)

# Reorder folders

Put a folder's contents in the order **you** choose, and renumber them to match — the number in each
folder's name and the one inside its folder note's `title` property.

Two commands, differing only in which row they reorder:

- `Reorder sibling folders...` reorders the folder you right-clicked **among its siblings**.
- `Reorder child folders...` reorders what is **inside** the folder you right-clicked.

## Try it

1. Right-click the `Reorder example` folder and choose `Reorder child folders...`.
2. The dialog lists `Alpha`, `Beta` and `Gamma` — **without** their numbers — each badged with the
   number it will get.
3. Drag `Alpha` to the bottom, or press its down arrow twice. The badges renumber as you go: the
   dialog is the preview, so there is no second confirmation.
4. Click **Reorder**.

Every folder is renumbered, not only the one you moved: `1. Beta`, `2. Gamma`, `3. Alpha`. Open any of
their `!` notes and the `title` property has followed the folder — while `aliases`, which holds the name
without the number, is untouched.

## Include files

Tick **Include files** in the dialog and the folder's own notes join the list as a second group. Folders
and notes are **two independent sequences**, each numbered from 1, because the file explorer always sorts
folders above files — one merged numbering could never be shown in the order it claims.

`Loose note` in `Reorder example` is there to try it on. The box starts from **Should include files when
reordering by default**, which is off, so reordering subfolders never silently renames the notes beside
them.

## The numbering is yours

Nothing about the `1.` prefix shape is hard-coded — **Reordered folder name template** decides it:

- `{{index}} {{safeFolderName}}` drops the period, `{{index}}-{{safeFolderName}}` changes it;
- `{{index:000}}` zero-pads, giving `007. Notes`;
- `{{safeFolderName}} ({{index}})` puts the number at the end.

Reading an existing number back uses the same template, so what writes the names and what recognizes
them can never disagree. **Reordered file name template** is the same thing for notes, kept separate so
folders and notes can be numbered differently.

## Which note is the folder note

`Reorder example` uses `!` as its folder-note name, which is what **Folder note name template** says.
Set **Folder note location** to `Auto` — the default — and the answer comes from the
`Folder notes` plugin instead, whenever you have it installed.

A folder note named after its folder (`{{folderName}}`) is renamed along with its folder, since
`1. Alpha/1. Alpha.md` would otherwise stop being a folder note the moment the folder is renumbered. A
fixed name like `!` needs no rename and gets none.
